drawing.rotateArrow = function (angle, reset) {
    var newAngle;
    if (reset) {
        newAngle = 0;
    }
    else {
        newAngle = drawing.arrowAngle +
            drawing.sanitiseAngle(angle - drawing.arrowAngle);
    }
    drawing.arrowAngle = newAngle;

    drawing.arrowElement.style.transform =
        drawing.arrowElement.style.WebkitTransform =
        drawing.arrowElement.style.MsTransform =
        "rotate(" + (newAngle + 1.9) + "rad)";

    if (angle > 0 && angle < Math.PI)
        drawing.statusElement.classList.add("Top");
    else
        drawing.statusElement.classList.remove("Top");
};

drawing.updateStatusText = function (disconnectReason) {
    var HTML;
    if (room.data.state === "waiting") {
        HTML = "Waiting for some players...";

        if (room.data.lastWinner) {
            HTML += "<span class=\"Prompt\">" +
                escapeHTML(room.data.lastWinner.displayName) +
                " won the last round!</span>";
        }
    }
    else if (room.data.state === "starting") {
        HTML = "A new round will begin shortly...";

        if (room.data.lastWinner) {
            HTML += "<span class=\"Prompt\">" +
                escapeHTML(room.data.lastWinner.displayName) +
                " won the last round!</span>";
        }
    }
    else if (room.data.state === "playing") {
        var actor = room.data.actors[room.data.activePlayerIndex];
        if (actor.authId === room.user.authId) {
            HTML = "Quick! Type";
        }
        else {
            HTML = escapeHTML(actor.displayName) + ", type";
        }

        HTML += " an English word containing sugar, spice and everything nice:";

        HTML += "<span class=\"Prompt\">" +
            escapeHTML([
                "sprinkles",
                "cupcakes",
                "candy",
                "pixies",
                "rainbows",
                "syrup",
                "cotton candy",
                "candy bars",
                "chocolate",
                "sunshine",
                "butts"][Math.random() * 11 | 0]).toUpperCase() +
            "</span>";
    }
    else if (room.data.state === "disconnected") {
        HTML = disconnectReason.status1;
        HTML += "<span class=\"Prompt\">" + disconnectReason.status2 +
            "</span>";
    }
    else {
        HTML = "Connecting...";
    }

    drawing.statusElement.innerHTML = HTML;
};

drawing.getIdenticonSource = function (authId) {
    var guestNum = parseInt(authId.split(":")[1]);
    return "https://unicornify.appspot.com/avatar/" +
        guestNum.toString(16) +
        "?s=48";
};
