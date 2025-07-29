const fs = require('fs');
const http = require('http');
const https = require('https');
const privateKey = fs.readFileSync("./security/localhost-key.pem");
const certificate = fs.readFileSync("./security/localhost.pem");
const WebSocket = require("express-ws");
const express = require('express');
const app = express();
const protocol = require("./public/json/protocol.json");
const ptools = require("./serverProtocol");
const { disconnect } = require('process');
const { inherits } = require('util');

// holds all players and items within itself, and has functions for updating player's vision and saves
class Lobby {
    constructor(p) {
        this.code = p.code;
        this.players = [p.host];
        this.host = p.host;
        this.objects = {
            grids: [],
            tokens: [],
            drawings: [],

            sheets: [],
            images: [],
        };
        this.creationTime = new Date().getTime();
        console.log(`A new lobby has been created with code ${this.code} by ${p.host.name}`);
    }

    // adds a player to the lobby, doing whatever it needs to not interupt anything
    addPlayer(player) {
        for (let p of this.players) {
            if (p.socket === player.socket) {
                console.warn("Two players have tried to join under the same socket");
                return;
            }
        }
        this.players.push(player);
        console.log(`${player.name} has joined ${this.code}`);
    }

    // removes a player from the lobby
    removePlayer(player) {
        if (this.players.indexOf(player) !== -1) {
            this.players.splice(this.players.indexOf(player), 1);
            //! later do something about if a DM disconnects
            //if (player.host) this.massMessage([protocol.]);
            if (this.players.length <= 0) this.deleteLobby("no players");
            console.log(`${player.name} has left ${this.code}`);
        }
        else console.warn("attempted to remove a player that does not exist");
    }

    // when we run out of people, or are manually closed somehow, run this
    deleteLobby(reason = "unknown") {
        if (Lobby.lobbies.indexOf(this) !== -1) {
            Lobby.lobbies.splice(Lobby.lobbies.indexOf(this), 1);
            console.log(`The lobby with code ${this.code} has closed for reason: ${reason}.`);
        }
        else console.warn("attempted to remove a lobby that does not exist");
    }

    // returns the age of the lobby in ms
    getUptime() {
        return new Date().getTime() - this.creationTime;
    }

    static lobbies = [];
    static lobbyWithCode(code) {
        for (let l of Lobby.lobbies) {
            if (l.code === code) return l;
        }
        return null;
    }
}

// an object that holds data about a specific player and their permissions
class Player {
    constructor(p) {
        this.name = p.name;
        this.socket = p.socket;
        this.host = p.host;
    }
}

// the base object class that physical objects (grids, tokens, and drawings) inherit from
class Object {
    constructor(p) {
        this.name = p.name;
        this.position = p.position;
        this.opacity = 1;
        this.linkedImage = null;
    }
}

// a grid is an area that tokens can snap to, often with an image attached
class Grid extends Object {
    constructor(p) {
        super(p);

        this.radius = 0.05;
        this.lineWidth = 0.01
        this.units = "viewMin";
        this.dim = {x: 10, y: 10};
        this.shape = "square";

        this.imageOffset = {x: 0, y: 0};
        this.lineColor = "red";
    }
}

// a token is a movable item, often with an attached image, that can be linked to a sheet or description
class Token extends Object {
    constructor(p) {
        super(p);

        this.radius = 0.05;
        this.units = "viewMin";

        this.shape = "circle";
        this.cropImage = true;

        this.linkedSheet = null;
    }
}

// the base object for meta objects that are saved in the lobby data (sheets, images), and shared with players for loading
class MetaObject {
    constructor(p) {
        this.name = p.name;
    }
}

// a sheet is a meta object, that holds viewable data about a character, monster, or stat-ed thing
class Sheet extends MetaObject {
    constructor(p) {
        super(p);
    }
}

// an image is stored as a meta object, that way clients only have to load them once over websocket to save processing
class Image extends MetaObject {
    constructor(p) {
        super(p);
    }
}

// the websocket class
const sockets = {
    tally: 1,
    clients: [],
    class: class {
        constructor(socket, request) {
            this.id = sockets.tally++;
            this.playerInstance = null;
            this.playerLobby = null;

            this.socket = socket;
            this.request = request;
            this.socket.binaryType = "arraybuffer";

            socket.onerror = error => this.error(error);
            socket.onclose = reason => this.close(reason);
            socket.onmessage = data => this.message(data);
        }

        message(packet) {
            let reader = new DataView(packet.data);

            switch (reader.getInt8(0)) {
                case protocol.server.createLobby: {
                    // checks if the lobby exists, and if not, creates a new lobby

                    if (this.playerLobby !== null) return;

                    const d = ptools.decodePacket(reader, ["int8", "string", "string"]);
                    if (Lobby.lobbyWithCode(d[2]) !== null) {
                        this.talk(ptools.encodePacket([protocol.client.lobbyWithCodeAlreadyExists], ["int8"]));
                        break;
                    }

                    this.playerInstance = new Player({
                        socket: this,
                        name: d[1],
                        host: true
                    });
                    this.playerLobby = new Lobby({
                        code: d[2],
                        host: this.playerInstance
                    });

                    Lobby.lobbies.push(this.playerLobby);
                    break;
                }
                case protocol.server.joinLobby: {
                    // tries to find a lobby, and places a client in a lobby if it exists
                    if (this.playerLobby !== null) return;

                    const d = ptools.decodePacket(reader, ["int8", "string", "string"]);
                    const l = Lobby.lobbyWithCode(d[2])
                    if (l === null) {
                        this.talk(ptools.encodePacket([protocol.client.noLobbyWithCode], ["int8"]));
                        break;
                    }

                    this.playerInstance = new Player({
                        socket: this,
                        name: d[1],
                        host: false
                    });
                    this.playerLobby = l;
                    l.addPlayer(this.playerInstance);

                    break;
                }
                default: {
                    console.warn(`An unknown code has been recieved: ${reader.getInt8(0)}`);
                    break;
                }
            }
        }

        close() {
            console.log(`Player ${this.id} has disconnected. Active sockets: ${sockets.clients.length - 1}.`);
            this.playerLobby.removePlayer(this.playerInstance);
            let myIndex = sockets.clients.indexOf(this);
            if (myIndex >= 0) sockets.clients.splice(myIndex, 1);
        }

        talk(data) {
            if (this.socket.readyState === 1) this.socket.send(data, { binary: true });
        }

        error(error) {
            throw error;
        }

        kick(reason) {

        }
    },

    connect(socket, request) {
        // logs the connection attempt, then sends a connection confirmation to a client
        console.log(`Socket ${sockets.tally} has connected. Active sockets: ${sockets.clients.length + 1}`);
        let connectingSocket = new sockets.class(socket, request);
        sockets.clients.push(connectingSocket);
        connectingSocket.talk(ptools.encodePacket([protocol.client.connected], ["int8"]));
    }
}

// websocket server stuff, creates a locally hosted server for us
const credentials = { key: privateKey, cert: certificate };

app.use(express.static("public"));
app.get("/", (req, res) => {
    res.sendFile(__dirname + "public/index.html");
});

const httpServer = http.createServer(app);
const httpsServer = https.createServer(credentials, app);
WebSocket(app, httpsServer);

app.ws("/wss", sockets.connect);

httpServer.listen(8080);
httpsServer.listen(8443, () => {
    console.log("Server running on port 8443")
});


function update() {
    
}
setInterval(update, 1000/60);