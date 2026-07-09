const express = require('express');

// ejs is a template library
// it allows us to store html in a file and then send it as back as response
const ejs = require('ejs');
const expressLayouts = require('express-ejs-layouts');
const app = express();


// read in our .env file
require("dotenv").config();

// tell Express that we are using ejs
app.set("view engine", "ejs");

// tell EJS which layout to use
app.set('layout', 'layouts/base')



app.get('/', function (req, res){

    const todayDate = new Date().toLocaleDateString("en-GB");

    // the first arg to res.render is the name 
    // of the ejs file to send back to the user
    // and it will be assumed to be in the views folder
    res.render("home", {
        "todayDate": todayDate
    });
             
})



app.listen(3000, function () {
    console.log("Server started");
})