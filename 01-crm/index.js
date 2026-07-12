const express = require('express');

// ejs is a template library
// it allows us to store html in a file and then send it as back as response
const ejs = require('ejs');
const expressLayouts = require('express-ejs-layouts');
const app = express();


// read in our .env file
require("dotenv").config();

// read in the connection variable
const connection = require('./db');

// read in the other routers
const productRouter = require('./productRouter');

app.use(expressLayouts)

// tell Express that we are using ejs
app.set("view engine", "ejs");

// tell EJS which layout to use
app.set('layout', 'layouts/base')


// enable form submission via browser
app.use(express.urlencoded({
    extended: true
}));

// register the productRouter with express
// if the url begins with "/products",
// pass the remainder of the URL to the productRouter
// for example: we go to /products/create
// the /products tell Express that we want to use the productRouter
app.use('/products', productRouter);



app.get('/', function (req, res){

    const todayDate = new Date().toLocaleDateString("en-GB");

    // the first arg to res.render is the name 
    // of the ejs file to send back to the user
    // and it will be assumed to be in the views folder
    res.render("home", {
        "todayDate": todayDate
    });
             
})

app.get('/customers', async function (req, res) {

    // extract out the user search terms from the form
    const { first_name, last_name } = req.query;

    // base query: returns all customers
    let sql = `
        SELECT * FROM Customers
            JOIN Companies ON
                Customers.company_id = Companies.company_id
            WHERE 1
    `

    const bindings = [];

    // check if the user is searching by first name
    if (first_name) {
        sql += " AND first_name LIKE ?";
        bindings.push("%" + first_name + "%");
    }

    if (last_name) {
        sql += " AND last_name LIKE ?";
        bindings.push("%" + last_name + "%");
    }

    sql += " ORDER BY Customers.first_name, Customers.last_name";

    console.log(`Executing sql: ${sql} with bindings ${JSON.stringify(bindings)}`)

    // connection.query takes in the SQL statement as parameter
    // and returns an array of two elements
    // index 0 is the results
    // index 1 is some metadata
    const [customers] = await connection.execute({
        "sql": sql,
        "nestTables": true
    }, bindings);

    res.render('customers/index', {
        customers: customers,
        searchParams: req.query
    })
})



// one route to display the form
app.get('/customers/create', async function (req, res) {
    const [companies] = await connection.execute("SELECT * FROM Companies");
    const [employees] = await connection.execute("SELECT * FROM Employees");

    // get all the products to display in the form
    const [products] = await connection.execute("SELECT * FROM Products");

    res.render('customers/create', {
        companies, employees, products
    })
})

// one route to process the form
app.post('/customers/create', async function (req, res) {
    // whenever the user has submitted via the form
    // is in req.body
    console.log(req.body);

    // a transaction allows us to perform two or more SQL updates or inserts or deletes
    // and count them as the same atomic operation

    // 1. get a connection instance from the connection pool
    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        // do all your SQL mutations (update, insert, delete) here
        const sql = `
        INSERT INTO Customers (first_name, last_name, email, company_id, employee_id)
            VALUES (?, ?, ?, ?, ?);
    `
        const [results] = await connection.execute(sql, [
            req.body.first_name,
            req.body.last_name,
            req.body.email,
            req.body.company_id,
            req.body.employee_id
        ]);

        // get the id of the newly created customers
        const newCustomerId = results.insertId;

        // products will be an array of product ids
        // p will be the id of the product that the user wants to add
        if (Array.isArray(req.body.products)) {
            for (let p of req.body.products) {
                const sql = `INSERT INTO CustomerProduct (customer_id, product_id) VALUES (?, ?)`;
                await connection.execute(sql, [newCustomerId, p]);
            }
        }
        // confirm all mutations
        await conn.commit();


    } catch (e) {
        await conn.rollback();
    } finally {
        await conn.release();
    }




    res.redirect('/customers')
})

// confirm with the user if they want to delete
app.get('/customers/:customer_id/delete', async function (req, res) {
    // use a prepared statement to query the database
    const [customers] = await connection.execute(
        "SELECT * FROM Customers where customer_id = ?", [req.params.customer_id]);

    // connection.execute will return an array if we do a SELECT
    // so if we only want the first result, we need to get from index 0.
    const customer = customers[0];

    res.render('customers/delete', {
        customer
    })
})

// process the delete
app.post('/customers/:customer_id/delete', async function (req, res) {
    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        await connection.execute("DELETE FROM CustomerProduct WHERE customer_id = ?", [req.params.customer_id])

        const sql = `DELETE FROM Customers WHERE customer_id = ?`;
        await connection.execute(sql, [req.params.customer_id]);

        await conn.commit();
    } catch (e) {
        await conn.rollback();
    } finally {
        await conn.release();
    }

    res.redirect('/customers')

})

// one route to display the edit form
app.get('/customers/:customer_id/update', async function (req, res) {
    // use a prepared statement to query the database
    const [customers] = await connection.execute(
        "SELECT * FROM Customers where customer_id = ?", [req.params.customer_id]);

    // connection.execute will return an array if we do a SELECT
    // so if we only want the first result, we need to get from index 0.
    const customer = customers[0];

    const [companies] = await connection.execute("SELECT * FROM Companies");
    const [employees] = await connection.execute("SELECT * FROM Employees");
    const [products] = await connection.execute("SELECT * FROM Products");
    const [selectedProductResults] = await connection.execute("SELECT * FROM CustomerProduct WHERE customer_id = ?", [req.params.customer_id])
    // for each element in selectedProductResults, we want a new array
    // that only consists of the product_id
    const selectedProducts = selectedProductResults.map(function (p) {
        return p.product_id;
    })
    console.log(selectedProducts);

    res.render('customers/edit', {
        customer, companies, employees, products, selectedProducts

    })
})

// one route to process the form
app.post('/customers/:customer_id/update', async function (req, res) {

    const conn = await connection.getConnection();
    try {
        await conn.beginTransaction();
        const { first_name, last_name, email, company_id, employee_id } = req.body;

        const sql = `UPDATE Customers SET
                        first_name = ?,
                        last_name = ?,
                        email = ?,
                        company_id = ?,
                        employee_id = ?
                   WHERE customer_id = ?
                  `;

        await connection.execute(sql, [first_name, last_name, email, company_id, employee_id, req.params.customer_id]);

        // update the products

        // 1. delete all the existing product relationships
        await conn.execute("DELETE FROM CustomerProduct WHERE customer_id = ?", [req.params.customer_id]);

        // 2. re-add all the product relationships from the form
        for (let p of req.body.products) {
            await conn.execute(`INSERT INTO CustomerProduct (customer_id, product_id) VALUES (?, ?)`,
                [req.params.customer_id, p]
            )
        }

        await conn.commit();
    } catch (e) {
        await conn.rollback();
    } finally {
        await conn.release();
    }

    res.redirect('/customers')


})


app.listen(3000, function () {
    console.log("Server started");
})