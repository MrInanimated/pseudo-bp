// ./game.server.js
//
// This is an object that manages the rooms

var
    gameServer   = {
        rooms: {
            regular: {},
            humanity: {},
            typefighter: {},
            sketch: {},
            anticipation: {},
            potables: {},
        },
        roomCount: 0
    },
    UUID         = require("node-uuid"),
    fs           = require("fs"),
    os           = require("os"),
    GameRoom     = require("./game.room.js"),
    roomTypes    = {
        regular: require("./gameTypes/regular.js"),
        humanity: require("./gameTypes/humanity.js"),
        typefighter: require("./gameTypes/typefighter.js"),
        sketch: require("./gameTypes/sketch.js").SketchRoom,
        anticipation: require("./gameTypes/anticipation.js"),
        potables: require("./gameTypes/potables.js").PotablesRoom,
    },
    dict         = require("./dictionaries.js");

gameServer.init = function (io, logger) {
    gameServer.io = io;
    gameServer._logger = logger;

    // load the dictionaries
    var loadStart = Date.now();
    var spec = JSON.parse(
        fs.readFileSync(
            __dirname + "/dictionaries/dictionaries.json").toString());
    this.dictionaries = {};
    var wordLists = {};

    for (var i in spec) {
        this.log("Loading dictionary \"" + i + "\"");
        var data = fs.readFileSync(__dirname + "/dictionaries/" + spec[i].path);
        wordLists[i] = {
            names: spec[i].names,
            words: data.toString().split(/\r?\n/g).filter(function (w) {
                return /^[a-z]+$/.test(w);
            }).sort()
        };
    }

    for (var n in wordLists) {
    	this.dictionaries[n] = {};
    	for (var j in dict) {
            if (spec[n].formats[j])
    		      this.dictionaries[n][j] = new dict[j](wordLists[n].words, n);
    	}
    }

    logger.info("Dictionaries loaded in %dms", Date.now() - loadStart);

    this.initialised = true;

};

gameServer.log = function (...args) {
    gameServer._logger.info("SERVER:\t" + args[0], ...args.slice(1));
};

gameServer.joinGame = function (socket, name, type) {
    if (!this.rooms[type][name]) {
        var RoomType = roomTypes[type] || roomTypes.regular;

        this.rooms[type][name] = new GameRoom(
            name, gameServer.io, RoomType, gameServer._logger, {
                dictionaries: this.dictionaries,
            });
        this.roomCount++;
    }

    gameServer.rooms[type][name].addUser(socket);
};

gameServer.leaveGame = function (socket) {
    // If there is a game with the socket's room name, disconnect from it
    if (this.rooms[socket.roomType] &&
        this.rooms[socket.roomType][socket.room]) {
        this.rooms[socket.roomType][socket.room].removeUser(socket);

        // If there are no users in that game, delete the game
        if (this.rooms[socket.roomType][socket.room].data.users.length === 0) {
            this.log("Destroying room " + socket.roomType + "/" + socket.room);
            this.rooms[socket.roomType][socket.room].deconstruct();
            delete this.rooms[socket.roomType][socket.room];
            this.roomCount--;
        }
    }
    else {
        // If the socket has a room name yet there's not a room with that name,
        // log an error
        if (socket.room) {
            console.error(
                "Cannot find room " + socket.roomType + "/" + socket.room + " of disconnecting socket");
        }
    }
};

module.exports = gameServer;
