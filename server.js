var net = require('net');
var http = require('http');
var WebSocketServer = require('websocket').server;
var clients = [];
var idList = [];
var runningGameInstances = {};
var awaitingGameInstances = {};
var chatRoomInstances = [];
// globalIdCounter should be server ID + local server counter + rand()
var globalIdCounter = 0;
var chatIdCounter = 0;
var gameStatesEnum = Object.freeze({
    CREATING_GAME: 0,
    AWAITING_PLAYERS_TO_JOIN: 1,
    STARTING_GAME: 2,
    AWAITING_PLAYER_INPUT: 3,
    COMPUTING_TURN_OUTCOME: 4,
    ENDING_GAME: 5,
    SHOWING_WINNERS: 6,
    SENDING_REWARDS: 7,
    CLOSING_GAME: 8
});
//create a function that returns a json to be ready to send
var messageTypesEnum = Object.freeze({
    GAME_GLOBAL_NOTIFICATION: 0,
    GAME_PERSONAL_NOTIFICAITON: 1,
    GAME_CHAT_MESSAGE: 2,
    LOGIN: 3,
    INFO_PLAYER_DATA: 4

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
        if (message.utf8Data) {
            this.requestCount++;
            console.log('From client [' + index + ']' + 'request : ' + this.requestCount + ' ' + message.utf8Data);
            // new query method
            var requestObject = convertToObject(message.utf8Data);
            switch (requestObject.messageType) {
                default:
                    break;
            }
            //
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

            if (body.startsWith('/game')) {
                let _input = body.slice(6);
                this.input = _input;
                this.send('Input received : ' + this.input);
            }

            if (body.startsWith('/createGame')) {
                if (!this.hasJoinedGame) {
                    let gameInstance = new gameInstanceBluePrint(globalIdCounter++);
                    let id = gameInstance.getId();
                    awaitingGameInstances[id] = gameInstance;
                    this.player = new createPlayer();
                    awaitingGameInstances[id].addClient(this);
                    this.hasJoinedGame = true;
                    this.gameId = id;
                    idList.push(id);
                    this.send('Game created and joined.');
                }
                else this.send('Player has already joined a game');
            }

            if (body.startsWith('/joinGame')) {
                if (awaitingGameInstances.length > 0) {
                    if (!this.hasJoinedGame) {
                        this.player = new createPlayer();
                        awaitingGameInstances[idList[0]].addClient(this);
                        this.hasJoinedGame = true;
                        this.gameId = idList[0];
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
                    let gameInstance = awaitingGameInstances[gameId];
                    //let gameInstance = awaitingGameInstances.find(function (_gameInstance) {
                    //    return _gameInstance.getId() === gameId;
                    //});
                    if (gameInstance) {
                        gameInstance.broadcast('Starting game.');
                        runningGameInstances[gameId] = gameInstance;
                        gameInstance.startGame();
                        delete awaitingGameInstances[gameId];
                    }

                    else this.send('Game Instance not found.');
                }
                else this.send('User has not joined a game.');
            }
            if (body.startsWith('/deleteGame')) {
                if (this.hasJoinedGame) {
                    let gameId = this.gameId;
                    let gameInstance = awaitingGameInstances[gameId];
                    if (gameInstance) {
                        gameInstance.broadcast('Game instance will be removed.');
                        gameInstance.releaseClients();
                        delete awaitingGameInstances[gameId];
                    } else this.send('Could not find game.');
                }
                else this.send('User has not joined a game.');
            }
        }
    });

    connection.on('close', function (reasonCode, desc) {
        
        //console.log('Client disconnected. Reason (if given)' + desc);
        //var index = clients.findIndex(connection);
        //clients.splice(index, 1);
        connection.send('bye');
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
var gameInstanceBluePrint = function (_id) {
    var instance = this;
    var id = _id;
    const GAME_TICKS = 250;
    const TURN_LENGTH = 1000;
    var turn = 0;
    var maxTurn = 4;
    var gameState = gameStatesEnum.CREATING_GAME;
    var turnTimer;
    var turnTickCounter = 0;
    var clientList = [];

    this.getId = () => { return id; };
    
    this.addClient = client => clientList.push(client);
    this.removeClient = client => {
        client.hasJoinedGame = false;
        client.gameId = -1;
        var index = clientList.indexOf(client);
        clientList.splice(index, 1);
    };
    this.getClients = () => { return clientList; };
    this.releaseClients = function () {
        clientList.forEach(client => {
            client.hasJoinedGame = false;
            client.gameId = -1;
        });
    };
    this.startGame = function () {
        if(gameState === gameStatesEnum.CREATING_GAME){
            gameState = gameStatesEnum.AWAITING_PLAYER_INPUT;
            instance.broadcast('Awaiting ' + TURN_LENGTH / 1000 + ' seconds for player input.');
            turnTimer = setInterval(this.checkForPlayerInput, GAME_TICKS);
        }
        else console.log('Game already started.');
    };

    this.checkForPlayerInput = function () {
        if (turnTickCounter < TURN_LENGTH / GAME_TICKS && gameState === gameStatesEnum.AWAITING_PLAYER_INPUT) {
            turnTickCounter++;
            return;
        }
        else {
            clearInterval(turnTimer);
            turnTickCounter = 0;
            gameState = gameStatesEnum.COMPUTING_TURN_OUTCOME;
            turn++;
            instance.broadcast('Executing turn ' + turn + '.');
            executeGame(instance);
            instance.checkForNextState();
        }
    };
    this.checkForNextState = function(){
        switch(gameState){
            case gameStatesEnum.COMPUTING_TURN_OUTCOME:
                if(turn < maxTurn){
                    gameState = gameStatesEnum.AWAITING_PLAYER_INPUT;
                    instance.broadcast('Awaiting ' + TURN_LENGTH / 1000 + ' seconds for player input.');
                    turnTimer = setInterval(this.checkForPlayerInput, GAME_TICKS);
                }
                else {
                    gameState = gameStatesEnum.ENDING_GAME;
                    //endGameFunction in future
                    clientList.forEach(function(client){
                        client.send('Game ended.\n Player coordinates : X = ' + client.player.xPos + '; Y = ' + client.player.yPos);
                    });
                    gameState = gameStatesEnum.ENDING_GAME;
                    instance.broadcast('Game will be removed.');
                    removeGameInstace(this);
                }
                break;
        }
    };
    this.broadcast = function (broadcastMessage) {
        clientList.forEach(function (client) {
            client.send(broadcastMessage);
        });
    };
};
var createPlayer = function () {
    this.hasPlayed = false;
    //data from DB further down the line
    this.xPos = 0;
    this.yPos = 0;
};
function broadcast(message, users) {
    users.forEach(function (user) {
        user.send(message);
    });
}
function executeGame(gameInstance)
{

    gameInstance.getClients().forEach(function (client) {
        switch(client.input){
            case 'up':
                client.player.yPos++;
                break;
            case 'down':
                client.player.yPos--;
                break;
            case 'right':
                client.player.xPos++;
                break;
            case 'left':
                client.player.xPos--;
                break;
        }
        client.input = '';
        client.send('Player coordinates : X = ' + client.player.xPos + '; Y = ' + client.player.yPos);
    });

}
function convertToJson (msgType, obj)
{
    var data = {
        messageType : msgType,
        data : obj
    };
    var jsonFile = JSON.stringify(data);
    return jsonFile;
}

function convertToObject(json) {
    return JSON.parse(json);
}
function removeGameInstace (gameInstance){
    gameInstance.releaseClients();
    delete runningGameInstances[gameInstance.getId()];
    console.log('Game instace [' + gameInstance.getId() + '] removed.');
}

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