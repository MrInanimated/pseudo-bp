// ./routes.js
//
// This manages all the routes for the express sever
// It's mostly self documenting, I would think

module.exports = function (app, gameServer) {

    // Load the index page by default
    app.get("/", function (req, res) {
        // console.time("indexLoad");

        if (req.session)
            req.session.lastVisited = "/";

        // console.time("getRooms");
        var rooms = [];
        for (var i in gameServer.rooms) {
            for (var j in gameServer.rooms[i]) {
                if (!gameServer.rooms[i][j].data.roomSettings.private) {
                    rooms.push({
                        name: j,
                        users: gameServer.rooms[i][j].data.users.length,
                        type: i,
                    });
                }
            }
        }

        rooms.sort(function (a, b) {
            return b.users - a.users;
        });

        // console.timeEnd("getRooms");

        // console.time("templateRender");
        res.render("index", {
            roomCount: gameServer.roomCount,
            rooms: rooms,
            dark: req.cookies.darkMode === "true",
            user: req.user || {
                displayName: "Guest",
                profileImage: "/images/AvatarPlaceholder.png",
                service: "",
                isGuest: true,
            },
        });
        // console.timeEnd("templateRender");

        // console.timeEnd("indexLoad");
    });

    app.get(/^\/(play|bpah|type|draw|anti|jeo)\/([^\/]+)/, function (req, res) {
        if (req.session)
            req.session.lastVisited = req.path;

        var roomName = req.params[1];
        roomName = roomName.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 30);
        if (roomName.length === 0) {
            return res.status(404).send("Cannot GET " + req.path);
        }

        var roomType = "regular";
        switch (req.params[0].toLowerCase()) {
            case "bpah":
                roomType = "humanity";
                break;
            case "type":
                roomType = "typefighter";
                break;
            case "draw":
                roomType = "sketch";
                break;
            case "anti":
                roomType = "anticipation";
                break;
            case "jeo":
                roomType = "potables";
                break;
        }

        res.render("gameTypes/" + roomType, {
            roomName: roomName,
            roomType: roomType,
            dark: req.cookies?.darkMode === "true",
            user: req.user || {
                displayName: "Guest",
                profileImage: "/images/AvatarPlaceholder.png",
                service: "",
                isGuest: true,
            },
            unicorn: roomName.toLowerCase() === "friendship",
        });
    });

    app.get("/changelog", function (req, res) {
        if (req.session)
            req.session.lastVisited = req.path;

        res.render("changelog", {
            dark: req.cookies.darkMode === "true",
            user : req.user || {
                displayName: "Guest",
                profileImage: "/images/AvatarPlaceholder.png",
                service: "",
                isGuest: true,
            },
        });
    });

    app.get("/privacypolicy", function (req, res) {
        if (req.session)
            req.session.lastVisited = req.path;

        res.render("privacypolicy", {
            dark: req.cookies.darkMode == "true",
            user : req.user || {
                displayName: "Guest",
                profileImage: "/images/AvatarPlaceholder.png",
                service: "",
                isGuest: true,
            },
        });
    });

    app.get("/userinfo", function (req, res) {
        if (req.session)
            req.session.lastVisited = req.path;

        res.render("userinfo", {
            dark: req.cookies.darkMode == "true",
            user : req.user || {
                displayName: "Guest",
                profileImage: "/images/AvatarPlaceholder.png",
                service: "",
                isGuest: true,
            },
            session: req.session,
        });
    });
};
