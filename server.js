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
        this.players = [];
        this.host = p.host;
        this.objects = {
            grids: [],
            tokens: [],
            drawings: [],

            sheets: [],
            images: [],
        };
        this.creationTime = new Date().getTime();
        console.log(`A new lobby has been created with code ${this.code}`);
        this.addPlayer(p.host);
    }

    // finds a specific asset by its ID and name
    findAssetById(id, name) {
        for (let sheet of this.objects.sheets) if (sheet.id === id && sheet.name === name) return sheet;
        for (let image of this.objects.images) if (image.id === id && image.name === name) return image;
        for (let token of this.objects.tokens) if (token.id === id && token.name === name) return token;
        for (let grid of this.objects.grids) if (grid.id === id && grid.name === name) return grid;
        return null;
    }

    // uploads a package of assets from a client
    uploadAssets(assets) {
        let newAsset = false;
        for (let i = 0; i < assets.length; i += 3) {
            //! make this sense type later
            for (let image of this.objects.images) if (image.id === assets[i + 0] && image.name === assets[i + 1]) continue;
            this.objects.images.push(new Image({id: assets[i + 0], name: assets[i + 1], data: assets[i + 2]}));
            newAsset = true;
        }
        if (!newAsset) return;
        console.log("assets uploaded");
        this.checkAssets();
    }

    // checks assets for all players to make sure they have what they need
    checkAssets() {
        let assetPacket = [
            protocol.client.assetInquiryPacket,
            this.objects.sheets.length + this.objects.images.length + this.objects.tokens.length + this.objects.grids.length
        ];
        for (let sheet of this.objects.sheets) assetPacket.push(sheet.id, sheet.name);
        for (let image of this.objects.images) assetPacket.push(image.id, image.name);
        for (let token of this.objects.tokens) assetPacket.push(token.id, token.name);
        for (let grid of this.objects.grids) assetPacket.push(grid.id, grid.name);
        assetPacket.push(0);
        for (let player of this.players) {
            player.talk(ptools.encodePacket(assetPacket, ["int8", "repeat", "int32", "string", "end"]));
        }
    }

    // packages assets for a player to send them the data they need for saving
    packageAssets(assets, player) {
        let requestedAssets = [protocol.client.assetDataPacket, 0];
        let requestedObjects = [];
        for (let i = 0; i < assets.length; i += 2) {
            const a = this.findAssetById(assets[i + 0], assets[i + 1]);
            if (a === null) {
                console.warn(`Asset ${assets[i + 1]} (${assets[i + 0]}) requested but not found`);
                continue;
            }
            if (a.type === "token" || a.type === "grid") {
                requestedObjects.push(a);
                continue;
            }
            requestedAssets.push(a.id, a.name, a.toString());
            requestedAssets[1]++;
        }
        requestedAssets.push(0);

        // now take all of the objects the client doesn't have and send them too
        requestedAssets.push(requestedObjects.length);
        for (let obj of requestedObjects) {
            requestedAssets = requestedAssets.concat(obj.toExport());
        }
        requestedAssets.push(0);

        player.talk(ptools.encodePacket(requestedAssets, [
            "int8", 
            "repeat", "int32", "string", "string", "end", 
            "repeat", 'string', 'int32', 'string', 'string', 'float32', 'float32', 'float32', 'string', 'int8', 'string', 'string', 'float32', 'int32', 'int32', 'string', 'int32', 'string', "end"
        ]));

    }

    // adds a token to the server, and syncs it with all players
    addToken(d) {
        let tokenFound = false;
        for (let token of this.objects.tokens) if (token.id === d[2] && token.name === d[3]) tokenFound = true;
        if (tokenFound) return;

        let token = new Token({
            type: d[1],
            id: d[2],
            name: d[3],
            description: d[4],
            radius: d[5],
            position: {x: d[6], y: d[7]},
            shape: d[8],
            cropImage: d[9],
            baseColor: d[10],
            lineColor: d[11],
            lineWidth: d[12],
            zIndex: d[13],
            linkedSheetAwait: {id: d[14], name: d[15]},
            linkedImageAwait: {id: d[16], name: d[17]},
        });

        this.objects.tokens.push(token);

        this.checkAssets();
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

        player.talk(ptools.encodePacket([protocol.client.successfulLobbyRequest, this.code, player.id], ["int8", "string", "int32"]));

        this.checkAssets();
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

    // sends a basic update with only data that changes every frame
    sendBasicUpdate() {
        let sending = [protocol.client.basicUpdate];

        // add player mouse positions
        sending.push(this.players.length);
        for (let player of this.players) {
            sending.push(
                player.id,
                player.mouseLocation.x + player.cameraLocation.x,
                player.mouseLocation.y + player.cameraLocation.y,
                player.mouseColor
            );
        }
        sending.push(0);

        for (let player of this.players) {
            player.talk(ptools.encodePacket(sending, ["int8", "repeat", "int32", "float32", "float32", "string", "end"]));
        }
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
        this.id = Math.floor(Math.random() * 2**31);
        this.host = p.host;
        this.mouseLocation = {x: 0, y: 0};
        this.mouseColor = "red";
        this.cameraLocation = {x: 0, y: 0};
    }

    // sends a message through a player's socket
    talk(data) {
        this.socket.talk(data);
    }
}

// the base object class that physical objects (grids, tokens, and drawings) inherit from
class Object {
    constructor(p) {
        this.name = p.name ?? "Unnamed Object";
        this.position = p.position ?? {x: 0, y: 0};
        this.opacity = p.opacity ?? 1;
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

        this.type = p.type ?? "token";
        this.id = p.id ?? Math.floor(Math.random() * 2**31);

        this.description = p.description ?? "";

        this.radius = p.radius ?? 20;

        this.shape = p.shape ?? "circle";
        this.cropImage = p.cropImage ?? true;
        this.baseColor = p.baseColor ?? "red";
        this.lineColor = p.lineColor ?? "white";
        this.lineWidth = p.lineWidth ?? 5;
        this.zIndex = p.zIndex ?? 0;

        this.linkedSheet = p.linkedSheet ?? null;
        this.linkedSheetAwait = p.linkedSheetAwait ?? {id: -1, name: ""};
        this.linkedImage = p.linkedImage ?? null;
        this.linkedImageAwait = p.linkedImageAwait ?? {id: -1, name: ""};
    }

    toExport() {
        return [
            this.type,
            this.id,
            this.name,
            this.description,
            this.radius,
            this.position.x,
            this.position.y,
            this.shape,
            this.cropImage ? 1 : 0,
            this.baseColor,
            this.lineColor,
            this.lineWidth,
            this.zIndex,
            this.linkedSheetAwait.id,
            this.linkedSheetAwait.name,
            this.linkedImageAwait.id,
            this.linkedImageAwait.name,
        ];
    }
}

// the base object for meta objects that are saved in the lobby data (sheets, images), and shared with players for loading
class MetaObject {
    constructor(p) {
        this.name = p.name;
        this.id = p.id ?? -1;
    }
}

// a sheet is a meta object, that holds viewable data about a character, monster, or stat-ed thing
class Sheet extends MetaObject {
    constructor(p) {
        super(p);
    }

    toString() {
        return "This is a character sheet :)";
    }
}

// an image is stored as a meta object, that way clients only have to load them once over websocket to save processing
class Image extends MetaObject {
    constructor(p) {
        super(p);
        this.data = p.data;
    }

    toString() {
        return this.data;
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
                // when a client requests an asset they don't have, package and send it to them
                case protocol.server.requestedAssets: {
                    const d = ptools.decodePacket(reader, ["int8", "repeat", "int32", "string", "end"]);
                    this.playerLobby.packageAssets(d[1], this.playerInstance);
                    break;
                }
                // when the client asks us to upload assets, save and attempt to distribute them
                case protocol.server.uploadRequiredAssets: {
                    const d = ptools.decodePacket(reader, ["int8", "repeat", "int32", "string", "string", "end"]);
                    this.playerLobby.uploadAssets(d[1]);
                    break;
                }
                // when a player moves their mouse, we update their last known mouse position
                case protocol.server.mouseMoveData: {
                    if (!this.playerLobby) return;
                    const d = ptools.decodePacket(reader, ["int8", "float32", "float32", "float32", "float32", "string"]);
                    this.playerInstance.cameraLocation = {x: d[1], y: d[2]};
                    this.playerInstance.mouseLocation = {x: d[3], y: d[4]};
                    this.playerInstance.mouseColor = d[5];
                    break;
                }
                // when a client creates a token, we sync it with all players
                case protocol.server.tokenCreated: {
                    if (!this.playerLobby) return;
                    const d = ptools.decodePacket(reader, ['int8', 'string', 'int32', 'string', 'string', 'float32', 'float32', 'float32', 'string', 'int8', 'string', 'string', 'float32', 'int32', 'int32', 'string', 'int32', 'string']);
                    this.playerLobby.addToken(d);
                    break;
                }
                // when a client sends a sanity check, make sure they have all their assets
                case protocol.server.sceneSanityCheck: {
                    if (!this.playerLobby) return;
                    this.playerLobby.checkAssets();
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
            if (this.playerLobby) this.playerLobby.removePlayer(this.playerInstance);
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

// runs at 30Hz to update the game
function update() {
    for (let l of Lobby.lobbies) {
        // send each player a basic data update with things like player mouse positions
        l.sendBasicUpdate();

        // check if any images have come in for our awaiting tokens
        for (let token of l.objects.tokens) {
            if (token.linkedImage !== null || token.linkedImageAwait.id === -1) continue;
            for (let image of l.objects.images) {
                if (image.id !== token.linkedImageAwait.id || image.name !== token.linkedImageAwait.name) continue;
                token.linkedImage = image;
            }
        }
    }
}
setInterval(update, 1000/30);