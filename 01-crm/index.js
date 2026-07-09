const express = require('express');


const ejs = require('ejs');
const app = express();



// tell Express that we are using ejs
app.set("view engine", "ejs");



app.get('/', function (req, res){
    res.render("home");
})



app.listen(3000, function () {
    console.log("Server started");
})