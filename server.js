const { exec } = require('child_process');
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const _ = require("lodash");
const { log, count } = require('console');
const findOrCreate = require("mongoose-findorcreate");

const app = express();
const port = 3000;


app.use(bodyParser.urlencoded({
  extended: true
}));

mongoose.connect("REMOVED_DB_URI",{useNewUrlParser: true});

const userSchema = new mongoose.Schema({
  email:String,
  password: String,
  // history: JSON
  history: [
    {
      downloadSpeed: Number,
      uploadSpeed: Number,
      downloaded: Number,
      uploaded: Number,
      latency: Number,
      bufferBloat: Number,
      userLocation: String,
      userIp: String
    },
  ],
});
var reqcount =0 ;
userSchema.plugin(findOrCreate);
const User = new mongoose.model("User",userSchema);

app.set('view engine', 'ejs');

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '/main.html'));
});

//-------------------------------------
app.get('/home.html',(req,res)=>{
  res.sendFile(path.join(__dirname + '/home.html'));
});
//----------------------------------------------
app.get('/signin.html',(req,res)=>{
  res.sendFile(path.join(__dirname + '/signin.html'));
});
//-------------------------------------
app.get('/signup.html',(req,res)=>{
  res.sendFile(path.join(__dirname + '/signup.html'));
});
//----------------------------------------
app.post('/signup.html',(req,res)=>{
  reqcount = 0;
  const newUser = new User({
    email: req.body.email,
    password: req.body.password,
  });
  newUser.save().then(()=>{
    res.redirect("/signin.html");
  }).catch((err)=>{
    console.log(err);
  })
});
//---------------------------------------
let userEmail = '';
app.post('/signin.html',(req,res)=>{
  reqcount = 0;
  userEmail = req.body.email;
  const username = req.body.email;
  const password = req.body.password;
  User.findOne({email: username}).then((foundUser)=>{
    if(foundUser){
      if(foundUser.password === password){
        res.redirect('/home.html');
      }
    }
  }).catch((err)=>{
    console.log(err);
    res.redirect('/signin.html');
  });
});
//--------------------------------------
app.get('/logout.html',(req,res)=>{
  userEmail = '';
  res.sendFile(path.join(__dirname + '/main.html'));
});
//----------------------------------------
app.get('/history.html',(req,res)=>{
  console.log(userEmail);
  User.findOne({email: userEmail}).then((foundUser)=>{
    if(foundUser){
      const userHistory = foundUser.history;
      
      // res.render('history', {username:foundUser.email,count: reqcount,down: userHistory.downloadSpeed,up: userHistory.uploadSpeed,downloaded: userHistory.downloaded,uploaded: userHistory.uploaded,latency: userHistory.latency,bufferbloat: userHistory.bufferBloat,userlocation: userHistory.userLocation,userip: userHistory.userIp});
      res.render('history',{username:foundUser.email,count: reqcount,nethistory: userHistory});
    }
    else{
      console.log("User Not found");
      res.redirect('/signin.html');
    }
  }).catch((err)=>{
    console.log(err);
    res.redirect('/signin.html');
  })
});


app.get('/speed', (req, res) => {
  exec('fast --upload --json', (error, stdout, stderr) => {
    if (stderr || error) {
      console.error(`Command error: ${stderr}`);
      res.status(500).send('An error occurred while executing the command.');
      return;
    }

    const jsonData = JSON.parse(stdout);
    const Data = jsonData;
    console.log(Data);
    res.send(Data);
      User.findOne({ email: userEmail })
      .then((foundUser) => {
        if (foundUser) {
          foundUser.history[reqcount] = jsonData; // Assign the JSON data to the user's history field
          reqcount = reqcount + 1;
          return foundUser.save(); // Save the updated user object
        } else {
          // Create a new user with the history data if the user doesn't exist
          res.sendFile(path.join(__dirname + '/signin.html'));
          // const newUser = new User({
          //   email: userEmail,
          //   history: JSON.stringify(jsonData),
          // });
          // return newUser.save();
        }
      });
  });
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
