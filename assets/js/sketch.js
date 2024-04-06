(function () {

// TODO: event handling on resize event
// to reset draggables if they're now offscreen

window.game = {};

paper.install(window);

var dragMoveListener = function (event) {

    var target = event.target,
    x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx,
    y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;

    target.style.webkitTransform =
    target.style.transform = 'translate(' + x + 'px, ' + y + 'px)';

    target.setAttribute("data-x", x);
    target.setAttribute("data-y", y);

    target.classList.add("dragging");
};

var dragStopListener = function (event) {
    event.target.classList.remove("dragging");
};

interact(".draggable")
    .draggable({
        restrict: {
            restriction: "parent",
            elementRect: { top: 0, left: 0, bottom: 1, right: 1 },
        },
        onmove: dragMoveListener,
        onend: dragStopListener,
    })
    .allowFrom(".handle");

game.activeColor = {
    red: 0,
    green: 0,
    blue: 0,
    alpha: 1,
};

var colorFunc = function (e, color) {
    var hex = color.toHex8();
    game.activeColor.alpha = parseInt(hex.substring(0, 2), 16) / 255;
    game.activeColor.red = parseInt(hex.substring(2, 4), 16) / 255;
    game.activeColor.green = parseInt(hex.substring(4, 6), 16) / 255;
    game.activeColor.blue = parseInt(hex.substring(6, 8), 16) / 255;
};

$("#Color").spectrum({
    flat: true,
    showAlpha: true,
    showInitial: true,
    showButtons: false,
    showPalette: true,
    palette: [
        ["#000","#444","#666","#999","#ccc","#eee","#f3f3f3","#fff"],
        ["#f00","#f90","#ff0","#0f0","#0ff","#00f","#90f","#f0f"],
        ["#f4cccc","#fce5cd","#fff2cc","#d9ead3","#d0e0e3","#cfe2f3","#d9d2e9","#ead1dc"],
        ["#ea9999","#f9cb9c","#ffe599","#b6d7a8","#a2c4c9","#9fc5e8","#b4a7d6","#d5a6bd"],
        ["#e06666","#f6b26b","#ffd966","#93c47d","#76a5af","#6fa8dc","#8e7cc3","#c27ba0"],
        ["#c00","#e69138","#f1c232","#6aa84f","#45818e","#3d85c6","#674ea7","#a64d79"],
        ["#900","#b45f06","#bf9000","#38761d","#134f5c","#0b5394","#351c75","#741b47"],
        ["#600","#783f04","#7f6000","#274e13","#0c343d","#073763","#20124d","#4c1130"]
    ],
});

$("#Tools a").click(function (event) {
    if (room.data.state !== "drawing" && room.data.state !== "guessed" ||
        room.data.currentArtist !== room.user.authId
    ) {
        return;
    }

    if (this.dataset.value === "clear") {
        room.socket.emit("draw:clear");
        drawing.clear();
    }
    else if (this.dataset.value === "undo") {
        room.socket.emit("draw:undo", room.user.id);
        drawing.undo(room.user.id);
    }
    else {
        $("#Tools a.Selected").removeClass("Selected");
        $(this).addClass("Selected");

        game.activeTool = this.dataset.value;
    }
});

$("#Widths a").click(function (event) {
    $("#Widths a.Selected").removeClass("Selected");
    $(this).addClass("Selected");

    game.width = parseInt(this.dataset.value);

    average = strokeWidths[game.width];
});

game.onRoomData = function () {
    room.actorsByAuthId = {};
    var i;

    for (i = 0; i < room.data.actors.length; i++) {
        var actor = room.data.actors[i];
        room.actorsByAuthId[actor.authId] = actor;
        var row = game.addScoreboardRow(actor);
    }

    $(".hidable")
        .css("display", "none");

    // Set up the references properly
    // Because the structure depends on shared references in a few objects
    // but the serialized JSON doesn't make the distinction
    // so I have to set them up again by replacing them with the correct
    // object
    if (room.data.currentDrawing) {
        room.data.drawings.pop();
        room.data.drawings.push(room.data.currentDrawing);

        for (i = 0; i < room.data.currentDrawing.paths.length; i++) {
            if (room.data.currentDrawing.currentPaths[room.data.currentDrawing.paths[i].userId]) {
                room.data.currentDrawing.paths[i] =
                room.data.currentDrawing.currentPaths[
                    room.data.currentDrawing.paths[i].userId
                ];

            }

            drawing.processPath(
                room.data.currentDrawing.paths[i].userId,
                room.data.currentDrawing.paths[i],
                room.data.currentDrawing.paths[i].points,
                true
            );

        }

        view.draw();
    }

    var statusMessage = "Waiting for players to join...";
    if (room.data.state === "drawing" || room.data.state === "guessed") {
        statusMessage =
            room.actorsByAuthId[room.data.currentArtist].displayName +
            " is drawing...";
        if (room.user.authId === room.data.currentArtist) {
            // Fuuuuuuck.
            // Screw it, I'm not setting up another route to request the word
            statusMessage =
                "Did you really have to rejoin on another window?";

            $(".hidable").css("display", "");
        }
        if (room.data.hint.state) {
            game.resolveHint(room.data.hint);
        }

        drawing.startTimer();
        if (room.data.state === "guessed") {
            drawing.startTicking();
            $("#Timer").addClass("Guessed");
            $("#ButtonContainer button").addClass("Disable");
        }
    }
    else if (room.data.state === "result") {
        statusMessage = room.data.lastWord.toUpperCase() + " was the word!";
    }
    else if (room.data.state === "ending") {
        statusMessage = "Waiting for the next round...";
        game.end = true;
    }
    else if (room.data.state === "waiting") {
        game.end = true;
    }

    $("#Status").text(statusMessage);

    if (["drawing", "guessed", "result"].indexOf(room.data.state) > -1) {
        $("#RoundCounter").text("Round " + room.data.rounds + " of " +
            room.data.currentRoundSettings.gameLength);
    }
};

$("#PassButton").click(function () {
    if (room.data.state === "drawing" &&
        room.data.currentArtist === room.user.authId
    ) {
        room.socket.emit("pass");
    }
});

$("#HintButton").click(function () {
    if (room.data.state === "drawing" &&
        room.data.currentArtist === room.user.authId
    ) {
        room.socket.emit("hint");
    }
});

$("#SkipButton").click(function () {
    if (room.data.state === "drawing" &&
        room.data.currentArtist === room.user.authId
    ) {
        room.socket.emit("skip");
    }
});

var multipliers = {
    0: 0.25,
    1: 0.5,
    2: 0.75,
    3: 1.25,
    4: 2,
};

var strokeWidths = {
    0: 1,
    1: 2,
    2: 5,
    3: 9,
    4: 15,
};

var canvas = document.getElementById("GameCanvas");
paper.setup(canvas);
var tool = new Tool();
tool.minDistance = 5;
tool.maxDistance = 50;

game.activeTool = "pen";
$('#Tools a[data-value="pen"]').addClass("Selected");
game.width = 2;
$('#Widths a[data-value="2"]').addClass("Selected");

game.activeColor = {
    red: 0,
    blue: 0,
    green: 0,
    alpha: 0.75,
};

var pathBuffer;

var path;
var placeholderCircle;

var average = strokeWidths[game.width];
var alpha = 0.125;

var progressInterval;
var progressTimer = false;

game.init = function () {
    tool.onMouseDown = function (event) {
        if (["drawing", "guessed"].indexOf(room.data.state) === -1 ||
            room.data.currentArtist !== room.user.authId) return;

        colorFunc(null, $("#Color").spectrum("get"));

        path = new Path();

        var radius;
        var color;
        if (game.activeTool === "pen") {
            color = path.fillColor = game.activeColor;
            radius = average / 2;
        }
        else {
            path.strokeWidth = strokeWidths[game.width];
            radius = strokeWidths[game.width] / 2;
            if (game.activeTool === "pencil") {
                color = path.strokeColor = game.activeColor;
            }
            else if (game.activeTool === "eraser") {
                color = path.strokeColor = {
                    red: 0,
                    green: 0,
                    blue: 0,
                    alpha: 1,
                };
                path.blendMode = "destination-out";
            }
            else if (game.activeTool === "fill") {
                color = game.activeColor;
                path.strokeColor = {
                    red: 0,
                    green: 0,
                    blue: 0,
                    alpha: 1,
                };
                path.strokeWidth = 1;
                radius = 0;
                path.closed = true;
                path.dashArray = [10, 4];
            }
        }

        pathBuffer = {
            points: [],
            userId: room.user.id,
            tool: game.activeTool,
            start: { x: event.point.x, y: event.point.y },
            width: game.width,
            point: { radius: radius },
            color: color,
        };

        path.add(event.point);

        placeholderCircle = new Path.Circle(event.point, radius);
        placeholderCircle.fillColor = color;

        if (game.activeTool === "eraser") {
            placeholderCircle.blendMode = "destination-out";
        }

        // For sync-y reasons
        room.data.currentDrawing.currentPaths[room.user.id] = pathBuffer;
        room.data.currentDrawing.paths.push(pathBuffer);
        pathBuffer.path = path;
        pathBuffer.placeholder = placeholderCircle;

        if (!progressTimer) {
            progressTimer = true;
            progressInterval = setInterval(function () {
                room.socket.emit("draw:progress", {
                    tool: pathBuffer.tool,
                    color: pathBuffer.color,
                    start: pathBuffer.start,
                    width: pathBuffer.width,
                    end: pathBuffer.end,
                    point: pathBuffer.point,
                }, pathBuffer.points);

                pathBuffer.points.length = 0;
            }, 100);
        }
    };

    tool.onMouseDrag = function (event) {
        if (["drawing", "guessed"].indexOf(room.data.state) === -1 ||
            room.data.currentArtist !== room.user.authId) return;

        if (!path || !pathBuffer || !progressTimer) return;

        if (pathBuffer.point) {
            pathBuffer.point = false;
            average = strokeWidths[game.width];
            placeholderCircle.remove();
        }

        var top, bottom;
        if (game.activeTool === "pen") {
            var newVal = event.delta.getLength() * multipliers[game.width];
            average = (alpha * newVal) + (1 - alpha) * average;

            step = event.delta;
            step.length = average / 2;
            step.angle += 90;

            top = event.middlePoint.add(step);
            bottom = event.middlePoint.subtract(step);

            path.add(top);
            path.insert(0, bottom);
        }
        else {
            top = bottom = event.middlePoint;

            path.add(top);
        }

        if (game.activeTool !== "fill")
            path.smooth();

        pathBuffer.points.push({
            top: { x: top.x, y: top.y },
            bottom: {x: bottom.x, y: bottom.y },
        });
    };

    tool.onMouseUp = function (event) {
        if (["drawing", "guessed"].indexOf(room.data.state) === -1 ||
            room.data.currentArtist !== room.user.authId) return;

        if (!path || !pathBuffer || !progressTimer) return;

        path.add(event.point);
        if (game.activeTool === "pen")
            path.closed = true;

        if (game.activeTool === "fill")
            path.closed = false;

        path.smooth();

        if (game.activeTool === "fill") {
            path.closed = true;

            path.strokeColor = null;
            path.fillColor = pathBuffer.color;
        }

        pathBuffer.end = { x: event.point.x, y: event.point.y };

        if (pathBuffer.point) {
            path.remove();
            pathBuffer.path = placeholderCircle;
            delete pathBuffer.placeholder;
        }

        if (progressTimer) {
            clearInterval(progressInterval);
            progressTimer = false;
        }

        room.socket.emit("draw:end", {
            tool: pathBuffer.tool,
            color: pathBuffer.color,
            start: pathBuffer.start,
            width: pathBuffer.width,
            end: pathBuffer.end,
            point: pathBuffer.point,
        }, pathBuffer.points);

        delete room.data.currentDrawing.currentPaths[room.user.id];
    };

    Mousetrap.bind(["ctrl+z", "meta+z"], function (e) {
        if (["drawing", "guessed"].indexOf(room.data.state) === -1 ||
            room.data.currentArtist !== room.user.authId) return;

        room.socket.emit("draw:undo", room.user.id);
        drawing.undo(room.user.id);
    });

    view.onResize = function () {
        var canvas = document.getElementById("GameCanvas");
        var parent = canvas.parentNode;
        view.setViewSize(parent.clientWidth, parent.clientHeight);
    };

    room.socket.on("addActor", function (actor) {
        room.data.actors.push(actor);
        room.actorsByAuthId[actor.authId] = actor;
        game.addScoreboardRow(actor);
    });

    room.socket.on("removeActor", function (event) {
        var authId = event.authId;
        var actor = room.actorsByAuthId[authId];
        var index = room.data.actors.indexOf(actor);

        room.data.actors.splice(index);
        delete room.actorsByAuthId[actor.authId];

        room.checkAndScrollChat(function () {
            $(".scoreboard_" + authId.replace(":", "_")).remove();
        });
    });

    // draw:progress listener
    room.socket.on("draw:progress", drawing.processPath);

    // draw:end listener
    room.socket.on("draw:end", drawing.processPath);

    // draw:undo listener
    room.socket.on("draw:undo", drawing.undo);

    // draw:clear listener
    room.socket.on("draw:clear", drawing.clear);

    // setState listener
    room.socket.on("setState", function (newState) {
        room.data.state = newState;

        if (["drawing", "guessed"].indexOf(newState) === -1) {
            $(".hidable").css("display", "none");
            $("#ChatInput")
                .removeAttr("disabled")
                .attr("placeholder", "Type here to guess.");
            drawing.stopTimer();
            $("#GameCanvas").removeClass("Playing");
        }

        if (newState !== "guessed") {
            $("#WordContainer").text("");
        }

        if (newState === "waiting") {
            $("#Status").text("Waiting for more players to join...");
            $("#WordContainer, #Timer").text("");
            $("#RoundCounter").text("");

            game.cleanUp();
            drawing.stopTimer();
            drawing.stopTicking();
        }
        else if (newState === "drawing") {
            if (game.end) {
                game.end = false;
                game.cleanUp();
            }

            room.data.rounds++;

            $("#RoundCounter").text("Round " + room.data.rounds + " of " +
                room.data.currentRoundSettings.gameLength);

            $("#ScoreboardContent tr").removeClass("Drawing")
                .removeClass("Guessed");

            $("#ButtonContainer button").removeClass("Disabled");

            // Begin a new drawing
            if (room.data.currentDrawing) {
                for (var i = 0; i < room.data.currentDrawing.paths.length; i++) {
                    var pathObj = room.data.currentDrawing.paths[i];
                    if (pathObj && pathObj.path) {
                        pathObj.path.remove();
                        delete pathObj.path;
                    }
                    if (pathObj && pathObj.placeholder) {
                        pathObj.placeholder.remove();
                        delete pathObj.placeholder;
                    }
                }

            }

            project.activeLayer.removeChildren();

            path = null;
            pathBuffer = null;

            if (progressTimer) {
                clearInterval(progressInterval);
                progressTimer = false;
            }

            room.data.currentDrawing = {
                paths: [],
                currentPaths: {},
            };
            room.data.drawings.push(room.data.currentDrawing);

            room.data.hint = { state: 0 };
            room.data.guessed = [];
            room.data.passCount = 0;

            room.data.roundStart = Date.now() + room.serverOffset;
            drawing.startTimer();

            view.draw();
        }
        else if (newState === "guessed") {
            $("#ButtonContainer button").addClass("Disabled");

            drawing.guessTimer();
            drawing.startTicking();
        }
        else {
            drawing.stopTicking();
            drawing.stopTimer();

            if (newState === "ending") {
                game.end = true;
            }
        }
    });

    room.socket.on("newRound", function (event) {
        room.data.currentArtist = event.artist;

        $("#ButtonContainer button").removeClass("Disabled");

        if (room.user.authId === event.artist) {
            $(".hidable").css("display", "");
            $("#ChatInput")
                .attr("disabled", "true")
                .attr("placeholder", "You're drawing.");
            $("#GameCanvas").addClass("Playing");

            room.appendToChat("Info", "It's your turn to draw.");

            audio.playSound("myTurn");
        }
        else {
            var actor = room.actorsByAuthId[event.artist];
            $("#Status").text(actor.displayName + " is drawing...");
            room.appendToChat(
                "Info", escapeHTML(actor.displayName) + " is drawing.");

            $(".hidable").css("display", "none");
            $("#GameCanvas").removeClass("Playing");
            $("#ChatInput")
                .removeAttr("disabled")
                .attr("placeholder", "Type here to guess.");

            audio.playSound("myTurn2");
        }

        $(".scoreboard_" + event.artist.replace(":", "_")).addClass("Drawing");
    });

    room.socket.on("drawWord", function (event) {
        $("#Status").text(
            event.word.toUpperCase() + " is your word to draw.");
    });

    room.socket.on("reveal", function (event) {
        room.data.lastWord = event.word;

        $("#Status").text(event.word.toUpperCase() + " was the word!");

        room.appendToChat("Info",
            escapeHTML(game.makePlayers(room.data.guessed)) +
            " found the word, \"" + escapeHTML(event.word) + "\".");
    });

    room.socket.on("success", function (event) {
        room.appendToChat("Info",
            "Congratulations! You guessed the word \"" + escapeHTML(event.word) +
            "\" and earned " + escapeHTML(event.score) + " points!");
    });

    room.socket.on("successfulGuess", function (event) {
        if (event.authId !== room.user.authId &&
            room.data.guessed.length === 0
        ) {
            room.appendToChat("Info", "The word has been found!");
        }

        if (event.authId === room.user.authId) {
            audio.playSound("success");
        }
        else {
            audio.playSound("otherSuccess");
        }

        room.data.guessed.push(event.authId);

        room.actorsByAuthId[event.authId].score = event.score;
        room.actorsByAuthId[room.data.currentArtist].score = event.artist;
        game.updateScores(event.authId, event.score, true);
        game.updateScores(room.data.currentArtist, event.artist);

        game.sortScoreboard();
    });

    room.socket.on("almost", function (event) {
        room.appendToChat("Info",
            "\"" + escapeHTML(event.almost) + "\" is close to the answer!");
        audio.playSound("almost");
    });

    room.socket.on("endGame", function (event) {
        $("#Status").text(game.makePlayers(event.winners) + " won!");

        room.appendToChat("Info",
            escapeHTML(game.makePlayers(event.winners)) + " " +
            (event.winners.length > 1 ? "were" : "was") + " the winner" +
            (event.winners.length > 1 ? "s" : "") + "!");

        if (event.winners.indexOf(room.user.authId) > -1) {
            audio.playSound("myTurn");
        }
    });

    room.socket.on("pass", function (event) {
        room.data.passCount++;

        var message = "The current artist passed the word \"%s\", " +
            "and now has a different word to draw.";
        if (room.data.currentArtist === room.data.authId) {
            message = "You passed the word \"%s\".";
        }

        room.appendToChat("Info", escapeHTML(message.replace("%s", event.wwi)));
        room.data.hint = { state: 0 };
        $("#WordContainer").text("");

        if (room.data.passCount >= 2) {
            $("#PassButton").addClass("Disabled");
        }
    });

    room.socket.on("skip", function (event) {
        room.data.lastWord = event.lastWord;

        var message = "";
        if (event.reason === "leave") {
            message = "The artist left.";
        }
        else {
            message = "The artist skipped.";
            room.data.rounds--;
        }

        message += " The word was \"" + event.wwi + "\".";

        room.appendToChat("Info", escapeHTML(message));
    });

    room.socket.on("hint", game.resolveHint);

    room.socket.on("afk", function (event) {
        var actor = room.actorsByAuthId[event.authId];
        actor.afk = event.afk;
        var className = ".scoreboard_" + event.authId.replace(":", "_");
        if (event.afk) {
            $(className).addClass("AFK");
        }
        else {
            $(className).removeClass("AFK");
        }

        if (event.authId === room.user.authId) {
            var message = "You're now marked as AFK.";
            if (!event.afk) {
                message = "You're no longer marked as AFK.";
            }
            room.appendToChat("Info", message);
        }
    });

    room.socket.on("settings:gameLength", function (e) {
        room.data.nextRoundSettings.gameLength = e;

        room.appendToChat("Info", "The next game will be " + e +
        " rounds long.");

        game.updateSettingsTab();
    });

    room.socket.on("settings:roundTimer", function (e) {
        room.data.nextRoundSettings.roundTimer = e;

        room.appendToChat("Info", "The next game will have " + e / 1000 +
        "s rounds.");

        game.updateSettingsTab();
    });

    room.socket.on("settings:wordLists", function (e) {
        room.data.nextRoundSettings.wordLists = e.list;
        var name;
        switch (e.wordList) {
            case "english_easy":
                name = "English (easy)";
                break;
            case "english_hard":
                name = "English (hard)";
                break;
            case "pokemon_pre3":
                name = "Pokémon (Gen I-III)";
                break;
            case "pokemon_post3":
                name = "Pokémon (Gen IV-VI)";
                break;
            case "countries":
                name = "Countries";
                break;
            case "animals":
                name = "Animals";
                break;
            case "full_english":
                name = "Full English";
                break;
            case "games":
                name = "Video Games";
                break;
            case "anime":
                name = "Anime";
                break;
            case "food":
                name = "Food";
                break;
            case "phrases":
                name = "Phrases";
                break;
        }

        if (e.operation === "add") {
            room.appendToChat("Info", "The " + name +
                " word list has been added for the next round.");
        }
        else {
            room.appendToChat("Info", "The " + name +
                " word list has been removed for the next round.");
        }

        game.updateSettingsTab();
    });

    room.socket.on("command:draworder", function (authIds) {
        room.appendToChat("Info", "Draw order: " +
            escapeHTML(
                authIds.map(function (i) {
                    return room.actorsByAuthId[i].displayName;
                }).join("; ")
            ));
    });

};

game.makePlayers = function (authIds) {
    if (authIds.length === 0) {
        return "Nobody";
    }

    var players = authIds.map(function (i) {
        if (room.actorsByAuthId[i])
            return room.actorsByAuthId[i].displayName;
        else
            return "(player left)";
    });

    var acc = "";

    for (var i = 0; i < players.length; i++) {
        acc += players[i];

        if (i < players.length - 2) {
            acc += ", ";
        }
        else if (i < players.length - 1) {
            acc += " and ";
        }
    }

    if (players.length < 3) {
        return acc;
    }
    else {
        return players.length + " players (" + acc + ")";
    }
};

game.resolveHint = function (hint) {
    room.data.hint = hint;

    var acc = "HINT: ";
    if (hint.length) {
        for (var i = 0; i < hint.length; i++) {
            if (hint[i]) {
                acc += hint[i].toUpperCase();
            }
            else {
                acc += "_";
            }
            acc += " ";
        }
    }

    if (hint.state >= 2) {
        $("#HintButton").addClass("Disabled");
    }

    $("#WordContainer").text(acc);
};

// This is basically the startGame function now
game.cleanUp = function () {
    room.data.currentRoundSettings = room.data.nextRoundSettings;
    room.data.nextRoundSettings = $.extend({}, room.data.currentRoundSettings);

    for (var i = 0; i < room.data.actors.length; i++) {
        room.data.actors[i].score = 0;
        room.data.actors[i].successful = false;
    }

    $("#ScoreboardContent td:last-child")
        .removeClass("Drawing")
        .removeClass("Guessed")
        .text("0");

    drawing.clear();

    room.data.drawings = [];
    room.data.currentDrawing = null;

    room.data.rounds = 0;
    room.data.hint = { state: 0 };
    room.data.guessed = [];
    room.data.passCount = 0;
};

game.onDisconnected = function (disconnectReason) {
    switch (disconnectReason) {
        case "kicked":
            $("#Status").text("It looks like you've been kicked!");
            break;
        case "banned":
            $("#Status").text("It looks like you've been banned!");
            break;
        default:
            $("#Status").text("It looks like you got disconnected...");
            break;
    }

    room.data.state = "disconnected";
    $("#GameCanvas").removeClass("Playing");
    drawing.stopTimer();
    drawing.stopTicking();
};

game.addScoreboardRow = function (actor) {
    var row = $(document.createElement("tr"))
        .addClass("scoreboard_" + actor.authId.replace(":", "_"))
        .append($(document.createElement("td"))
            .text(actor.displayName))
        .append($(document.createElement("td"))
            .text(actor.score));

    if (["drawing", "guessed", "result"].indexOf(room.data.state > -1)) {
        if (actor.authId === room.data.currentArtist) {
            row.addClass("Drawing");
        }
        if (actor.successful) {
            row.addClass("Guessed");
        }
        if (actor.afk) {
            row.addClass("AFK");
        }
    }

    room.checkAndScrollChat(function () {
        $("#ScoreboardContent").append(row);
    });

    game.sortScoreboard();

    return row;
};

game.sortScoreboard = function () {
    room.checkAndScrollChat(function () {
        var $rows = $("#ScoreboardContent").find("tr");

        $rows.sort(function (a, b) {
            var getScore = function (el) {
                return parseInt($(el).find("td:last-child").text());
            };

            return getScore(b) - getScore(a);
        });

        $rows.detach().appendTo($("#ScoreboardContent"));
    });
};

game.updateScores = function (authId, score, found) {
    $row = $(".scoreboard_" + authId.replace(":", "_"));

    if (found) {
        $row.addClass("Guessed");
    }

    $row.find("td:last-child").text(score);
};

var roles = {
    none: 0,
    mod: 1,
    host: 2,
};

game.initiateSettingsTab = function () {
    var setupButtons = function (blockName, eventName, controlFunction) {
        var control = document.getElementById(blockName);
        var buttons = control.getElementsByTagName("a");
        controlFunction = controlFunction || function (e) {
            if (room.user.role >= roles.host) {
                room.socket.emit(eventName, this.dataset.value);
            }
        };
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener("click", controlFunction);
        }
    };

    setupButtons("GameLengthControl", "settings:gameLength");
    setupButtons("RoundTimerControl", "settings:roundTimer");

    $("#WordListsControl a").click(function (event) {
        if (room.user.role >= roles.host) {
            room.socket.emit("settings:wordLists", {
                wordList: this.dataset.value,
                operation: this.classList.contains("Selected") ? "remove" : "add",
            });
        }
    });
};

game.updateSettingsTab = function () {
    var canModify = room.user.role >= roles.host;

    var i, j;

    var unmodifiableControls = [
        "GameLengthControl",
        "RoundTimerControl",
        "WordListsControl",
    ].map(document.getElementById, document);

    for (i = 0; i < unmodifiableControls.length; i++) {
        unmodifiableControls[i].classList[canModify ? "remove": "add"](
            "Disabled");
    }

    var highlightValue = function (blockName, value) {
        var control = document.getElementById(blockName);
        var buttons = control.getElementsByTagName("a");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].dataset.value === String(value)) {
                buttons[i].classList.add("Selected");
            }
            else {
                buttons[i].classList.remove("Selected");
            }
        }
    };

    highlightValue("GameLengthControl",
        room.data.nextRoundSettings.gameLength);
    highlightValue("RoundTimerControl",
        room.data.nextRoundSettings.roundTimer);

    $("#WordListsControl a").each(function (index, element) {
        if (room.data.nextRoundSettings.wordLists.indexOf(element.dataset.value) > -1) {
            element.classList.add("Selected");
        }
        else {
            element.classList.remove("Selected");
        }
    });
};

game.remakeScoreboard = function () {

};

window.drawing = {};

drawing.processPath = function (userId, pathOpts, newPoints, wait) {
    var currentPath = room.data.currentDrawing.currentPaths[userId];
    var data = room.data;

    if (!currentPath) {
        currentPath = pathOpts;
        currentPath.points = currentPath.points || [];
        currentPath.userId = userId;
        data.currentDrawing.currentPaths[userId] = currentPath;
        if (!wait) data.currentDrawing.paths.push(currentPath);

        currentPath.path = new Path();

        if (currentPath.tool === "pen") {
            currentPath.path.fillColor = currentPath.color;
        }
        else {
            currentPath.path.strokeColor = currentPath.color;
            currentPath.path.strokeWidth = strokeWidths[currentPath.width];
            if (currentPath.tool === "eraser")
                currentPath.path.blendMode = "destination-out";

            if (currentPath.tool === "fill") {
                currentPath.path.strokeWidth = 1;
                currentPath.path.strokeColor = { red: 0, green: 0, blue: 0, alpha: 1};
                currentPath.path.closed = true;
                currentPath.path.dashArray = [10, 4];
            }
        }

        currentPath.path.add(new Point(currentPath.start));

        if (currentPath.point) {
            currentPath.placeholder =
                new Path.Circle(
                    new Point(currentPath.start), currentPath.point.radius);
            currentPath.placeholder.fillColor = currentPath.color;
            if (currentPath.tool === "eraser")
                currentPath.placeholder.blendMode = "destination-out";
        }
    }

    if (!currentPath.path) {
        currentPath.path = new Path();
    }

    for (var i = 0; i < newPoints.length; i++) {
        currentPath.path.add(new Point(newPoints[i].top));
        if (currentPath.tool === "pen")
            currentPath.path.insert(0, new Point(newPoints[i].bottom));
    }

    if (!wait)
        currentPath.points = currentPath.points.concat(newPoints);

    currentPath.point = pathOpts.point;

    if (currentPath.tool !== "fill")
        currentPath.path.smooth();

    if (!currentPath.point && currentPath.placeholder) {
        currentPath.placeholder.remove();
        delete currentPath.placeholder;
    }

    if (pathOpts.end) {
        delete data.currentDrawing.currentPaths[userId];

        currentPath.end = pathOpts.end;

        if (currentPath.point) {
            currentPath.path.remove();
            currentPath.path = currentPath.placeholder;
            delete currentPath.placeholder;
        }
        else {
            currentPath.path.add(new Point(currentPath.end));
            if (currentPath.tool === "pen")
                currentPath.path.closed = true;

            if (currentPath.tool === "fill")
                currentPath.path.closed = false;

            currentPath.path.smooth();

            if (currentPath.tool === "fill") {
                currentPath.path.closed = true;

                currentPath.path.strokeColor = null;
                currentPath.path.fillColor = currentPath.color;
            }
        }
    }

    if (!wait) view.draw();
};

drawing.undo = function (userId) {
    if (room.data.currentDrawing) {
        delete room.data.currentDrawing.currentPaths[userId];

        // Find the last element in the paths that has the userId
        var index = -1;
        for (var i = room.data.currentDrawing.paths.length - 1; i >= 0; i--) {
            if (room.data.currentDrawing.paths[i].userId === userId) {
                index = i;
                break;
            }
        }
        if (index !== -1) {
            var pathObj = room.data.currentDrawing.paths.splice(index, 1)[0];
            if (pathObj) {
                if (pathObj.path)
                    pathObj.path.remove();
                if (pathObj.placeholder)
                    pathObj.placeholder.remove();
            }
        }

        if (userId === room.user.id) {
            if (progressTimer) {
                progressTimer = false;
                clearTimeout(progressInterval);
            }
        }

        view.draw();
    }
};

drawing.clear = function () {
    if (room.data.currentDrawing) {
        for (var i = 0; i < room.data.currentDrawing.paths.length; i++) {
            if (room.data.currentDrawing.paths[i]) {
                if (room.data.currentDrawing.paths[i].path)
                    room.data.currentDrawing.paths[i].path.remove();
                if (room.data.currentDrawing.paths[i].placeholder)
                    room.data.currentDrawing.paths[i].placeholder.remove();
            }
        }

        room.data.currentDrawing.paths = [];
        room.data.currentDrawing.currentPaths = {};
    }

    if (progressTimer) {
        clearInterval(progressInterval);
        progressTimer = false;
    }

    path = null;
    pathBuffer = null;

    project.activeLayer.removeChildren();

    view.draw();
};

var timerInterval;

var sounds = {
    tick: "/sounds/tick.wav",
    almost: "/sounds/failWord.wav",
    success: "/sounds/success.wav",
    otherSuccess: "/sounds/otherSuccess.wav",
    myTurn: "/sounds/myTurn.wav",
    myTurn2: "/sounds/myTurn2.wav",
};

for (var i in sounds) {
    audio.loadSound(i, sounds[i]);
}

drawing.startTimer = function () {
    clearInterval(timerInterval);
    timerInterval = setInterval(function () {
        var elapsed = Date.now() - room.data.roundStart + room.serverOffset;
        var timeLeft = room.data.currentRoundSettings.roundTimer - elapsed;

        var seconds = Math.ceil(timeLeft / 1000);

        $("#Timer").text(Math.max(seconds, 0));
    }, 250);
};

drawing.guessTimer = function () {
    $("#Timer").addClass("Guessed");
    var timeLeft = room.data.currentRoundSettings.roundTimer - Date.now() + room.data.roundStart - room.serverOffset;
    timeLeft = Math.min(30 * 1000, timeLeft);
    room.data.roundStart = Date.now() + timeLeft + room.serverOffset - room.data.currentRoundSettings.roundTimer;
};

drawing.stopTimer = function () {
    clearInterval(timerInterval);
    $("#Timer").text("").removeClass("Guessed");
};

var tickTimeout;
drawing.startTicking = function () {
    clearTimeout(tickTimeout);
    drawing.tickSource = audio.playSound("tick", {
        loop: true,
    });
    if (!drawing.tickSource)
        tickTimeout = setTimeout(drawing.startTicking, 1000);
};

drawing.stopTicking = function () {
    if (drawing.tickSource)
        drawing.tickSource.stop(0);
    clearTimeout(tickTimeout);
};

$(function () {
    if (!$("#Scoreboard").hasClass("Open")) {
        $("#ShowScoreboard").click();
    }
});

})();
