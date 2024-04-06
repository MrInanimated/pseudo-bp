(function () {

// This is a nice clusterfuck of jQuery that I thought up in a half-awake state
// urgh
// At least the serverside code actually looks okay

window.game = {};

// Delegated event listeners
// Because reattching event listeners each time is annoying
// Although this is inefficient

$(document).on("click", ".JoinGameButton", function (e) {
    room.socket.emit("join");
});

$(document).on("click", ".StartGameButton", function (e) {
    room.socket.emit("startGame");
});

$(document).on("click", ".InputCard .CardSubmit", function (e) {
    var response = $(".InputCard .CardResponse").val();
    if (response.toLowerCase().indexOf(room.data.prompt) > -1) {
        room.socket.emit("response", response);
    }
    else {
        $(".InputCard .CardStatus")
            .text("Must contain '" + room.data.prompt.toUpperCase() + "'!");
    }
});

$(document).on("click", ".ForceEnd", function (e) {
    room.socket.emit("forceEnd");
});

$(document).on("click", ".Card.Choosable", function (e) {
    room.socket.emit("choice", $(this).data("index"));
});

$(document).on("click", ".NextRoundButton", function (e) {
    room.socket.emit("nextRound");
});

game.onRoomData = function () {
    room.actorsByAuthId = {};

    for (var i = 0; i < room.data.actors.length; i++) {
        var actor = room.data.actors[i];
        room.actorsByAuthId[actor.authId] = actor;
        var row = game.addScoreboardRow(actor);
    }

    drawing.redrawCards();
    drawing.updateStatus();
};

game.init = function () {
    // addActor listener
    room.socket.on("addActor", function (actor) {
        room.data.actors.push(actor);
        room.actorsByAuthId[actor.authId] = actor;
        game.addScoreboardRow(actor);
        drawing.updateStatus();
        room.appendToChat("Info",
            room.userName(room.usersByAuthId[actor.authId]) + " is now playing.");

        if (room.data.state === "answering" &&
            actor.authId === room.user.authId &&
            actor.authId !== room.data.czar &&
            !room.data.hasAnswered[room.user.authId]) {
            drawing.pushCard("input");
        }

    });

    // removeActor listener
    room.socket.on("removeActor", function (event) {
        var authId = event.authId;
        var actor = room.actorsByAuthId[authId];
        var index = room.data.actors.indexOf(actor);
        if (room.data.state !== "waiting") {
            if (authId === room.data.czar) {
                room.appendToChat("Info",
                    "The czar just left the game. Are you guys really that boring?");
            }

            room.data.actors.splice(index, 1);
            delete room.actorsByAuthId[actor.authId];

            room.checkAndScrollChat(function () {
                $(".scoreboard_" + authId.replace(":", "_")).remove();
            });
        }
        drawing.updateStatus();
    });

    // setState listener
    room.socket.on("setState", function (newState) {
        room.data.state = newState;
        if (newState === "waiting") {
            room.data.actors = [];
            room.actorsByAuthId = {};

            room.data.czar = "";
            room.data.responses = [];
            room.data.responsePlayers = [];
            room.data.lastWinner = "";
            room.data.hasAnswered = {};

            drawing.updateStatus();
            $("#InstructionCards").html("");
            $("#PlayerCards").html("");
            $("#ScoreboardContent").html("");
        }
    });

    // newRound listener
    room.socket.on("newRound", function (event) {
        room.data.czar = event.czar;
        room.data.card = event.card;
        room.data.prompt = event.prompt;
        drawing.remakeInstructionCards();
        drawing.updateStatus();

        $("#PlayerCards").html("");

        room.appendToChat("Info",
            room.userName(room.usersByAuthId[room.data.czar]) + " is the Card Czar!");

        if (room.actorsByAuthId[room.user.authId] &&
            room.data.czar !== room.user.authId) {
            drawing.pushCard("input");
        }
    });

    // response listener
    room.socket.on("response", function (event) {
        room.data.hasAnswered[event.authId] = 1;
        drawing.pushCard("hidden");

        if (event.authId === room.user.authId) {
            $(".InputCard").remove();
        }
    });

    // emitResponses listener
    room.socket.on("emitResponses", function (responses) {
        $("#PlayerCards").html("");
        room.data.responses = responses;
        for (var i = 0; i < responses.length; i++) {
            drawing.pushCard("response", {
                contents: responses[i],
            }).data("index", i);
        }

        if (room.data.czar === room.user.authId) {
            $("#PlayerCards .Card").addClass("Choosable");
        }

        drawing.updateStatus();
    });

    // revealResponses listener
    room.socket.on("revealResponses", function (event) {
        room.data.lastWinner = event.winner;
        room.data.lastWinnerName = event.winnerName;

        if (room.actorsByAuthId[event.winner]) {  // the winner might've left
            $(".scoreboard_" + event.winner.replace(":", "_"))
                .find("td:last-child").text(++room.actorsByAuthId[event.winner].points);
        }

        var winner = room.actorsByAuthId[event.winner] || {
            displayName: event.winnerName,
            authId: event.winner,
            points: 0,
        };

        if (winner.points >= 5) {
            room.appendToChat("Info",
                room.userName(winner) + " has won the game!");
        }
        else {
            room.appendToChat("Info",
                room.userName(winner) + " has won the round.");
        }

        room.data.responsePlayers = event.players;
        var responseCards = $("#PlayerCards .Card");
        for (var i = 0; i < event.players.length; i++) {
            $(responseCards[i])
                .find(".CardOwner")
                .text(event.players[i].displayName + "'s card!");
            if (event.players[i].authId === event.winner) {
                $(responseCards[i]).addClass("Winner");
            }
        }

        drawing.updateStatus();
    });

    $("#ShowScoreboard").click();
};

game.onDisconnected = function (disconnectReason) {
    switch (disconnectReason) {
        case "kicked":
            $("#StatusContainer").text("It looks like you've been kicked!");
            break;
        case "banned":
            $("#StatusContainer").text("It looks like you've been banned!");
            break;
        default:
            $("#StatusContainer").text("It looks like you got disconnected...");
            break;
    }
};

game.initiateSettingsTab = function () {

};

game.updateSettingsTab = function () {

};

game.remakeScoreboard = function () {
};

game.addScoreboardRow = function (actor) {
    var row = $(document.createElement("tr"))
        .addClass("scoreboard_" + actor.authId.replace(":", "_"))
        .append($(document.createElement("td"))
            .text(actor.displayName))
        .append($(document.createElement("td"))
            .text(actor.points));

    room.checkAndScrollChat(function () {
        $("#ScoreboardContent")
            .append(row);
    });

    return row;
};

window.drawing = {};

drawing.updateStatus = function () {
    var isCzar = room.data.czar === room.user.authId;
    var isPlaying = room.actorsByAuthId[room.user.authId];

    switch (room.data.state) {
        case "waiting":
            if (room.data.actors.length < 2) {
                var playersNeeded = 2 - room.data.actors.length;
                $("#StatusContainer").text("Waiting for " + playersNeeded +
                    " more player" + (playersNeeded === 1 ? "": "s") + " to join...");
            }
            else {
                $("#StatusContainer").text("Waiting for the first player to start the game...");
            }

            if (room.data.actors.length > 1 && room.data.actors[0].authId === room.user.authId) {
                $("#StatusContainer").append(
                    $(document.createElement("button"))
                        .addClass("StartGameButton")
                        .addClass("Button")
                        .text("Start Game"));
            }

            break;

        case "answering":
            if (isPlaying) {
                if (isCzar) {
                    $("#StatusContainer")
                        .text("You're the Czar! Sit back and wait for these scrubs to think of something.")
                        .append(
                            $(document.createElement("button"))
                            .addClass("ForceEnd")
                            .addClass("Button")
                            .text("Force End"));
                }
                else {
                    $("#StatusContainer")
                        .text("Time to type in your answers!");
                }
            }
            else {
                $("#StatusContainer")
                    .text("The players are typing in answers to the question...");
            }

            break;

        case "choosing":
            if (isCzar) {
                $("#StatusContainer")
                    .text("Choose the best answer!");
            }
            else {
                $("#StatusContainer")
                    .text("The Czar is making their decision...");
            }

            break;

        case "revealed":
            var lastWinner = room.actorsByAuthId[room.data.lastWinner] || {
                displayName: room.data.lastWinnerName,
                authId: room.data.lastWinner,
                points: 0,
            };
            if (lastWinner.points >= 5) {
                $("#StatusContainer")
                    .text(lastWinner.displayName + " won the game!");
                if (isCzar) {
                    $("#StatusContainer")
                        .append($(document.createElement("button"))
                            .addClass("NextRoundButton")
                            .addClass("Button")
                            .text("End Game"));
                }
            }
            else {
                $("#StatusContainer")
                    .text(lastWinner.displayName + " won the round.");
                if (isCzar) {
                    $("#StatusContainer")
                        .append($(document.createElement("button"))
                            .addClass("NextRoundButton")
                            .addClass("Button")
                            .text("Next Round"));
                }
            }

            break;
    }

    // Allow users to join if they aren't playing
    if (!isPlaying && room.data.state !== "disconnected") {
        $("#StatusContainer").append(
            $(document.createElement("button"))
                .addClass("JoinGameButton")
                .addClass("Button")
                .text("Join Game"));
    }
};

// Only call this function upon joining the room
drawing.redrawCards = function () {
    var i;
    switch (room.data.state) {
        case "waiting":
            break;

        case "answering":
            drawing.remakeInstructionCards();

            for (i in room.data.hasAnswered) {
                drawing.pushCard("hidden");
            }
            break;

        case "choosing":
            drawing.remakeInstructionCards();

            for (i = 0; i < room.data.responses.length; i++) {
                drawing.pushCard("response", { contents: room.data.responses[i] });
            }
            if (room.data.czar === room.user.authId) {
                $("#PlayerCards .Card").addClass("Chooseable");
            }

            break;

        case "revealed":
            drawing.remakeInstructionCards();

            for (i = 0; i < room.data.responses.length; i++) {
                var card = drawing.pushCard("response", {
                    contents: room.data.responses[i],
                    owner: room.data.responsePlayers[i].displayName,
                });
                if (room.data.responsePlayers[i].authId === room.data.lastWinner) {
                    card.addClass("Winner");
                }
            }

            break;

    }
};

drawing.remakeInstructionCards = function () {
    $("#InstructionCards").html("");
    drawing.pushCard("instruction", {
        contents: room.data.card,
    });
    drawing.pushCard("instruction", {
        contents: "Your prompt is " + room.data.prompt.toUpperCase() + ".",
    });
};

drawing.pushCard = function (type, options) {
    // DOM manipulation with jQuery,
    // yaaaaaaay
    var card = $(document.createElement("div"))
        .addClass("Card")
        .append($(document.createElement("div"))
            .addClass("CardInner")
            .append($(document.createElement("div"))
                .addClass("CardOwner"))
            .append($(document.createElement("div"))
                .addClass("CardContents"))
            .append($(document.createElement("div"))
                .addClass("CardFooter")
                .append($(document.createElement("div"))
                    .addClass("CardStatus"))
                .append($(document.createElement("button"))
                    .addClass("CardSubmit")
                    .addClass("Button")
                    .text("Submit"))));
    // You know, I don't think that was better to do with jQuery

    switch (type) {
        case "instruction":
            card.find(".CardContents").html(options.contents);
            $("#InstructionCards").append(card);
            break;
        case "input":
            card.addClass("InputCard")
                .find(".CardContents")
                .append($(document.createElement("textarea"))
                    .addClass("CardResponse"));
            card.find(".CardOwner")
                .text("Type in your answer here!");
            $("#PlayerCards").prepend(card);
            break;
        case "hidden":
            $("#PlayerCards").append(card.addClass("Hidden"));
            break;
        case "response":
            if (options.owner) {
                card.find(".CardOwner").text(options.owner + "'s card!");
            }
            card.find(".CardContents").html(options.contents);
            $("#PlayerCards").append(card);
            break;
    }
    return card;
};

})();