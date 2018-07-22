var net = require('net');
var http = require('http');
var WebSocketServer = require('websocket').server;
var clients = [];
var runningGameInstances = [];
var awaitingGameInstances = [];
var chatRoomInstances = [];
// globalIdCounter should be server ID + local server counter + rand()
var globalIdCounter = 0;
var chatIdCounter = 0;
var gameStatesEnum = Object.freeze({
    CREATING_GAME: 0,
    AWAITING_PLAYERS: 1,
    STARTING_GAME: 2,
    AWAITING_PLAYER_INPUT: 3,
    COMPUTING_TURN_OUTCOME: 4,
    ENDING_GAME: 5,
    SHOWING_WINNERS: 6,
    SENDING_REWARDS: 7,
    CLOSING_GAME: 8
});
var chatRoom = function (_id) {
    var id = _id;
    this.getId = () => { return id; };
    var subscribedClients = [];
    this.addClient = client => {
        subscribedClients.push(client);
        client.chatRoomId.push(id);
    };
    this.removeClient = client => {
        var index = subscribedClients.indexOf(client);
        subscribedClients.splice(index, 1);
        index = client.chatRoomId.indexOf(id);
        client.chatRoomId.splice(index, 1);
    };
    this.globalBroadcast = function (broadcastMessage) {
        subscribedClients.forEach(function (client) {
            client.send('[GLOBAL] ' + broadcastMessage);
        });
    };
    this.broadcastFromClient = function (_client, broadcastMessage) {
        subscribedClients.forEach(function (client) {
            if (client !== _client)
                client.send('[' + _client.nickname + '] ' + broadcastMessage);
        });
    };
};
_chatRoom = new chatRoom(chatIdCounter++);
chatRoomInstances.push(_chatRoom);

var server = http.createServer(function (req, res) { });
server.listen(1337, function () {
    console.log('System waiting at http://localhost:1337');
});


var wsServer = new WebSocketServer({ httpServer: server });

wsServer.on('request', function (request) {
    //chatRoomInstances.push(new chatRoom(chatIdCounter++));

    console.log(new Date() + 'Conection from origin' + request.origin + '.');
    var connection = request.accept(null, request.origin);
    connection.requestCount = 0;
    connection.nickname = '';
    connection.chatRoomId = [];
    connection.sw = new fsmSwOBject();
    console.log(new Date() + ' Connection accepted.');
    connection.send('Connection accepted. Please input : "/nick your_Nickname".\n input "/help" for more info.');
    var index = clients.push(connection) - 1;

    connection.on('message', function (message) {
        this.requestCount++;
        console.log('From client [' + index + ']' + 'request : ' + this.requestCount + ' ' + message.utf8Data);
        var body = message.utf8Data;
        if (body.startsWith('sw.')) {
            var transition = body.slice(3);
            var info = this.sw.handle(transition);
            this.send(info);
        } else if (body === 'time') this.send('Time elapsed : ' + this.sw.getTimeElapsed());

        if (body.startsWith('/help')) {
            this.send(getHelp());
        }

        if (body.startsWith('/nick')) {
            let name = body.slice(6);
            this.nickname = name;
            this.send(name + ' set as nickname. ');
        }

        if (body.startsWith('/joinChat')) {
            chatRoomInstances[0].globalBroadcast(this.nickname + ' joined the chat room.');
            chatRoomInstances[0].addClient(this);
            this.send('Joined chat.');
        }
        // change when several chats exist
        if (body.startsWith('/leaveChat')) {
            chatRoomInstances[0].removeClient(this);
            chatRoomInstances[0].globalBroadcast(this.nickname + ' left the chat room.');
            this.send('Exited chat.');
        }
        if (body.startsWith('/chat')) {
            let message = body.slice(6);
            chatRoomInstances[0].broadcastFromClient(this, message);
        }


        if (body.startsWith('/createGame')) {
            if (!this.hasJoinedGame) {
                let gameInstance = new gameInstanceBluePrint(globalIdCounter++);
                awaitingGameInstances.push(gameInstance);
                awaitingGameInstances[0].addPlayer(new createPlayer(this));
                this.hasJoinedGame = true;
                this.gameId = awaitingGameInstances[0].getId();
                this.send('Game created and joined.');
            }
            else this.send('Player has already joined a game');
        }

        if (body.startsWith('/joinGame')) {
            if (awaitingGameInstances.length > 0) {
                if (!this.hasJoinedGame) {
                    awaitingGameInstances[0].addPlayer(new createPlayer(this));
                    this.hasJoinedGame = true;
                    this.gameId = awaitingGameInstances[0].getId();
                    this.send('Game joined.');
                }
                else this.send('User joined game already.');
            }
            //fallback to create game later
            else this.send('No games currently running. Please create game');
        }
        if (body.startsWith('/startGame')) {
            if (this.hasJoinedGame) {
                let gameId = this.gameId;
                let gameInstance = awaitingGameInstances.find(function (_gameInstance) {
                    return _gameInstance.getId() === gameId;
                });
                if (gameInstance) {
                    gameInstance.broadcast('This message should only be seen by players who joined.');
                    runningGameInstances.push(gameInstance);
                    gameInstance.startGame();
                    let index = awaitingGameInstances.indexOf(gameInstance);
                    awaitingGameInstances.splice(index, 1);
                }
                else this.send('Game Instance not found.');
            }
            else this.send('User has not joined a game.');
        }
        if (body.startsWith('/deleteGame')) {
            if (this.hasJoinedGame) {
                let gameId = this.gameId;
                let gameInstance = runningGameInstances.find(function (_gameInstance) {
                    return _gameInstance.getId() === gameId;
                });
                if (gameInstance) {
                    gameInstance.broadcast('Game instance will be removed.');
                    gameInstance.releasePlayers();
                    let index = runningGameInstances.indexOf(gameInstance);
                    runningGameInstances.splice(index, 1);
                } else this.send('Could not find game.');
            }
            else this.send('User has not joined a game.');
        }
    });

    connection.on('close', function (reasonCode, desc) {
        
        //console.log('Client disconnected. Reason (if given)' + desc);
        //var index = clients.findIndex(connection);
        //clients.splice(index, 1);
    });
    });
wsServer.on('close', function (socketConnection, reason, desc) {
    var i = clients.indexOf(socketConnection);
    clients.splice(i, 1);
    
    console.log('Client closed connection. Reason : ' + desc);
});

var stopWatch = function () {
    var startAt = 0;
    var lastStopped = 0;

    var now = () => { return new Date().getSeconds(); };

    this.start = function () {
        startAt = now();
    };

    this.stop = function () {
        lastStopped += now() - startAt;
        startAt = 0;
    };

    this.reset = function () {
        startAt = 0;
        lastStopped = 0;
    };

    this.timeElapsed = () => { return startAt === 0 ? 0 + lastStopped : lastStopped + now() - startAt; };

    };
var fsmSwOBject = function () {
    var sw = new stopWatch();
    var states = ['off', 'counting', 'stopped'];
    var currentState = 'off';

    this.getCurrentState = () => { return currentState; };
    this.handle = function (transition) {
        switch (transition) {
            case 'start':
                if (currentState === states[0] || currentState === states[2]) {
                    sw.start();
                    currentState = states[1];
                }
                else return 'cannot start if stopwatch already running';
                return 'stopwatch started.';
            case 'stop':
                if (currentState === states[1]) {
                    sw.stop();
                    currentState = states[2];
                }
                else return 'can only stop if stopwatch is running.';
                return 'stopwatch stopped.';
            case 'reset':
                if (currentState === states[2]) {
                    sw.reset();
                    currentState = states[0];
                }
                else return 'cannot reset while stopwatch is running.';
                return 'stopwatch reset.';
        }
    };
    this.getTimeElapsed = () => { return sw.timeElapsed(); };
};
var gameInstanceBluePrint = function ( _id) {
    var id = _id;
    var gameState = gameStatesEnum.CREATING_GAME;
    this.getId = () => { return id; };
    var playerList = [];
    this.addPlayer = player => playerList.push(player);
    this.removePlayer = player => {
        player.connection.hasJoinedGame = false;
        player.connection.gameId = -1;
        var index = playerList.indexOf(player);
        playerList.splice(index, 1);
    };
    this.releasePlayers = function () {
        playerList.forEach(player => {
            player.connection.hasJoinedGame = false;
            player.connection.gameId = -1;
        });
    };
    var gameTurn = 0;
    this.startGame = function () {
        this.broadcast('sup homie');
        while (gameTurn < 10) {
            gameTurn++;
            
            //setTimeout(this.broadcast('sup homie'), 2500);
        }
    };

    this.broadcast = function (broadcastMessage) {
        playerList.forEach(function (player) {
            player.connection.send(broadcastMessage);
        });
    };
};
var createPlayer = function (client) {
    this.connection = client;
    //data from DB further down the line
    this.xPos = 0;
    this.yPos = 0;
};


var getHelp = () => {
    var message = '\nGame commands:\n' +
        '   - /createGame\n' +
        '   - /joinGame\n' +
        '   - /startGame\n' +
        'Chat commands :\n' +
        '   - /joinChat\n' +
        '   - /leaveChat\n' +
        '   - /chat your_message\n';
    return message;
};