// ./sockets.js
// This file manages the socket.io server

var
    UUID             = require("node-uuid");

import { Server } from "socket.io";
import cookie from 'cookie';

module.exports = function (server, gameServer, logger) {
    const sio = new Server(server, {
        transports: ["websocket"],
        logger: {
            debug: logger.debug,
            info: logger.info,
            error: logger.error,
            warn: logger.warn,
        }
    });
    gameServer.init(sio, logger);

    var guestNum = 0;

    sio.sockets.on("connection", function (socket) {
        socket.userId = UUID();

        // If the socket is logged in, we get the credentials from the request object
        if (socket.request.user?.logged_in) {
            socket.authId = socket.request.user.authId;
            socket.displayName = socket.request.user.displayName;
            socket.profileImage = socket.request.user.profileImage;
        }
        else {
            // otherwise, we assign some guest credentials
            const cookies = socket.handshake?.headers?.cookie ? cookie.parse(socket.handshake.headers.cookie) : {};

            if (cookies.preferredName) {
                const preferredName = [...cookies.preferredName].slice(0, 30).join("");
                socket.displayName = preferredName;
            } else {
                socket.displayName = "Guest " + guestNum;
            }

            socket.authId = "guest:" + guestNum;
            guestNum++;
        }
        logger.info("SERVER:\t socket " + socket.userId + " connected.");
        socket.emit("onconnected", {id: socket.userId, authId: socket.authId});

        socket.joinedRoom = false;
        socket.on("joinRoom", function (room, type) {
            if (!socket.joinedRoom) {
                if (typeof room !== "string" ||
                    ["regular", "humanity", "typefighter", "sketch", "anticipation", "potables"].indexOf(type) === -1) {
                    socket.disconnect();
                    return;
                }

                socket.joinedRoom = true;
                gameServer.joinGame(socket, room, type);
            }
        });

        socket.on("disconnect", function () {
            logger.info("SERVER:\t socket " + socket.userId + " left.");
            if (socket.joinedRoom)
                gameServer.leaveGame(socket);
        });
    });
};
