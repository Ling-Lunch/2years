var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var bodyParser = require('body-parser');
var fs = require('fs');
var touch = require("touch")
var routes = require('./routes');
var redis = require('redis');
var uuid = require('uuid');
var _ = require('lodash');
var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);

// connect db
var db = redis.createClient();
db.on('connect', function() {
    console.log('db connected');
});

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(favicon(__dirname + '/public/logo.png'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: false
}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', routes.index);

var recentMessageTimes = {}; // Recent message timestamps by socket ID
var lastMessages = {}; // Last message by user
var greyListStatuses = {}; // Timestamps of too much spamming by socket ID
var connectionsByIP = {}; // Number of connections by IP
var usertags = {}; // Nicknames by socket.id

numOfUsers = 0;
var messageColors = ["#FFFFFF", "#43ADF9", "1CF7D8", "#F9EA43"];
io.on('connection', function(socket) {
    var userIp = socket.client.request.headers['x-forwarded-for'];
    console.log(userIp);

    for (var id in usertags) {
        if (socket.handshake.query.tag.length > 0 && usertags[id] ===
            socket.handshake.query.tag) {
            socket.disconnect();
            return;
        }
    }

    var tag = socket.handshake.query.tag.trim().replace(/\s/g, '');
    tag = tag.substr(0, 10);

    // Creates new number of connections for new users
    if (connectionsByIP[userIp]) {
        connectionsByIP[userIp]++;

        // If user connects 4th time with same IP, disallow
        if (connectionsByIP[userIp] > 3) {
            connectionsByIP[userIp]--;
            socket.disconnect();
            return;
        }
    }
    // Or simply increments number of connections
    else
        connectionsByIP[userIp] = 1;

    usertags[socket.id] = tag;

    // antiSpam.onConnect(socket);
    recentMessageTimes[socket.id] = [];
    greyListStatuses[socket.id] = [];

    numOfUsers++;
    io.emit('user count', numOfUsers);
    // Get old messages
    db.keys('*', function(err, keys){
        if (err) console.error(err);
        console.log(keys);
        _.forEach(keys, function(unit_key){
            db.get(unit_key, function(errs, rep){
                if (errs) console.error(errs);
                console.log(rep);
                io.emit('new message', JSON.parse(rep));
            });
        });
    });
    console.log("User connected, total: " + numOfUsers);

    socket.on("new message", function(message) {
        if (typeof(message) != 'string') {
            socket.disconnect();
            return;
        }

        // Soft anti-spam measures
        var recent = recentMessageTimes[socket.id];
        if (recent.length == 5 && recent[0] > Date.now() - 5000) {
            var greyListStatus = greyListStatuses[socket.id];
            if (greyListStatus.length == 5 && greyListStatus[0] >
                Date.now() - 5000) {
                console.log("Stop spamming");
                delete greyListStatuses[socket.id];
                socket.disconnect();
            } else {
                greyListStatus.push(new Date());
                if (greyListStatus.length > 5)
                    greyListStatus.shift();
            }

            console.log(greyListStatuses)
            return;
        }

        if (lastMessages[socket.id] == message)
            return;
        else
            lastMessages[socket.id] = message;

        // Message validation, randomized styling and broadcasts
        if (message.length > 0 && message.length < 100) {
            var top = getRandomInt(10, 85);
            var left = getRandomInt(2, 90);
            var fontSize = (message.length < 25) ?
                getRandomFloat(1, 2) : getRandomFloat(0.8, 1.3);
            var randomColorInd = message.match(/(语言学午餐|語言學午餐|linglunch|ling-lunch)/i) == null ? getRandomInt(0, 3) : 3;
            var color = [messageColors[randomColorInd],
                messageColors[randomColorInd]
            ];
            var thisUsertag = usertags[socket.id];

            // save to db
            var unitMessage = {
                "msg": message,
                "cssTop": top,
                "cssLeft": left,
                "cssFontSize": fontSize,
                "cssColor": color,
                "usertag": thisUsertag
            };
            thisId = uuid.v4();
            db.set(thisId, JSON.stringify(unitMessage));
            db.expire(thisId, 7200);

            io.emit('new message', unitMessage);
            // console.log("New message: " + message);
        }

        recent.push(new Date());
        if (recent.length > 5) {
            recent.shift();
        }
    });

    // On user disconnect
    socket.on('disconnect', function() {
        connectionsByIP[userIp]--;
        numOfUsers--;
        io.emit('user count', numOfUsers);
        console.log("User disconnected, total: " + numOfUsers);
        delete recentMessageTimes[socket.id];
        delete greyListStatuses[socket.id];
        delete lastMessages[socket.id];
        delete usertags[socket.id];
    });
});

// Some helper functions
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomFloat(min, max) {
    return (Math.random() * (max - min) + min).toFixed(1);
}


// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = server;
