const express = require('express');
const router = express.Router();
const connection = require('./db');

// for file uploading
const fileUpload = require('express-fileupload');

// utlity for manging files
const path = require('path');

// fs is the file system (operating system functions to manage files)
const fs = require('fs');
const { chunkPDF, generateEmbedding } = require('./rag');
const { PDFDataRangeTransport } = require('pdf-parse');

// enable file upload
router.use(fileUpload());

router.get('/', async function (req, res) {
    const [products] = await connection.execute({
        sql: 'SELECT * from Products LEFT JOIN PDF ON Products.pdf_id = PDF.pdf_id',
        nestTables: true
    });


    res.render('products/index', {
        results: products
    });

})

router.get('/search', async function(req, res){
    //extract out the query string
    const query = req.query.searchTerms;
    
    if (!query) {
        return res.redirect('/products');
    }

    //create the embedding from query
    const queryEmbedding = await generateEmbedding(query);
    const vectorString = '[' + queryEmbedding + ']';

    //do the vector search
    const [results] = await connection.execute(`
        SELECT DISTINCT
            Products.products_id,
            Products.name,
            Products.description,
            Products.pdf_id,
            PDF.filename,
            PDF.original_filename,
            PDFChunks.chunk_text,
            VEC_DISTANCE(PDFChunks.embedding, VEC_FromText(?)) AS distance
        FROM PDFChunks
            JOIN PDF ON PDFChunks.pdf_id = PDF.pdf_id
            JOIN Products ON Products.pdf_id = PDF.pdf_id
        ORDER BY distance ASC
        LIMIT 10
    `, [vectorString]);

    res.render('products/search', {
        query: query,
        results: results

    })    
})

router.get('/:product_id', async function (req, res) {
    const [products] = await connection.execute({
        sql: 'SELECT * from Products LEFT JOIN PDF ON Products.pdf_id = PDF.pdf_id WHERE product_id = ?',
        nestTables: true
    }, [req.params.product_id]);
    const product = products[0];
    res.render('products/details', {
        product: product
    });

})

// route to upload file
router.get('/:product_id/upload', async function (req, res) {
    // get the product that we are uploading file 
    const [products] = await connection.execute("SELECT * FROM Products WHERE product_id = ?", [req.params.product_id]);

    // extract out the first product from the results
    const product = products[0];

    res.render('products/upload', {
        product
    })
})

// route to process file upload
router.post('/:product_id/upload', async function (req, res) {
    console.log(req.files);
    const conn = await connection.getConnection();
    try {
        await conn.beginTransaction();

        // 1. check if a file has been uploaded
        // when uploading file to Express using express-fileupload
        // all the uploaded files will be req.files
        if (!req.files || !req.files.pdf) {
            throw new Error('No file uploaded');
        }

        // 2. check if the file is pdf
        const pdfFile = req.files.pdf;
        if (path.extname(pdfFile.name).toLowerCase() !== '.pdf') {
            throw new Error('Only PDF files are allowed');
        }

        // 3. save the file 
        // __dirname always refers to the directory the current file is in
        const uploadDir = path.join(__dirname, 'uploads');

        // create the directory if doex not exist
        console.log("Creating the upload directory");
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // 4. generate a unique file name for the file before saving it
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = uniqueSuffix + path.extname(pdfFile.name);
        const filePath = path.join(uploadDir, filename);

        // 5. move the file to the upload directory
        console.log("Moving the upload file");
        await pdfFile.mv(filePath);

        // 6. insert a new row in the PDF table to store
        // the PDF's file name and other data.
        const productId = req.params.product_id;
        const [result] = await conn.execute(
            'INSERT INTO PDF (filename, original_filename, file_path, file_size) VALUES (?, ?, ?, ?)',
            [filename, pdfFile.name, filePath, pdfFile.size]
        );
        const newPdfId = result.insertId;

        // 7. update the product with the new pdf id
        await conn.execute(
            'UPDATE Products SET pdf_id = ? WHERE product_id = ?',
            [newPdfId, productId]
        );

        // TODO 8: Chunk the PDF and create the embeddings
        const chunks = await chunkPDF(filePath);
        for (const chunk of chunks) {
            // create an embedding for each chunk
            const embeddingValues = await generateEmbedding(chunk.text);
            // turn the embedding values in a vector string (mariadb requirement)
            const vectorString = '[' + embeddingValues + ']';

            await conn.execute(`
                INSERT INTO PDFChunks (pdf_id, chunk_text, chunk_order, embedding)
                    VALUES (?, ?, ?, VEC_FromText(?))
                `, [newPdfId, chunk.text, chunk.order, vectorString])
       
        }

        await conn.commit();
        res.redirect('/products/' + productId)

    } catch (e) {
        console.error(e);
        await conn.rollback();
        res.status(500).send("Unable to process file upload");
    } finally {
        await conn.release();
    }


})

// whatever is exported is available for other JS files in the same nodejs application to use
module.exports = router;