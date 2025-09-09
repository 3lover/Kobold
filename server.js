const fs = require('fs');
const http = require('http');
const https = require('https');
const privateKey = fs.readFileSync("./security/localhost-key.pem");
const certificate = fs.readFileSync("./security/localhost.pem");
const WebSocket = require("express-ws");
const express = require('express');
const compression = require("compression");
const cors = require("cors");
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

        // now send every token
        let tokenCount = requestedAssets.length;
        requestedAssets.push(0);
        for (let obj of requestedObjects) {
            if (obj.type !== "token") continue;
            requestedAssets = requestedAssets.concat(obj.toExport());
            requestedAssets[tokenCount]++;
        }
        requestedAssets.push(0);

        // and finally every grid
        let gridCount = requestedAssets.length;
        requestedAssets.push(0);
        for (let obj of requestedObjects) {
            if (obj.type !== "grid") continue;
            requestedAssets = requestedAssets.concat(obj.toExport());
            requestedAssets[gridCount]++;
        }
        requestedAssets.push(0);

        player.talk(ptools.encodePacket(requestedAssets, [
            "int8", 
            "repeat", "int32", "string", "string", "end", 
            "repeat", 'string', 'int32', 'string', 'string', 'float32', 'float32', 'float32', 'string', 'int8', 'string', 'string', 'float32', 'int32', "int8", 'int32', 'string', 'int32', 'string', "int32", "end",
            "repeat", "string", "int32", "string", "float32", "float32", "float32", "float32", "float32", "string", "string", "float32", "int32", "int32", "string", "int32", "end"
        ]));

    }

    // adds a token to the server, and syncs it with all players
    addToken(d) {
        let tokenFound = null;
        for (let token of this.objects.tokens) if (token.id === d[19]) tokenFound = token;
        if (tokenFound !== null) {
            if (d[19] === d[2]) return;
            this.objects.tokens.splice(this.objects.tokens.indexOf(tokenFound), 1);
        }

        let token = new Token({
            type: d[1],
            id: d[2],
            name: d[3],
            description: d[4],
            radius: d[5],
            position: {x: d[6], y: d[7]},
            shape: d[8],
            cropImage: !!d[9],
            baseColor: d[10],
            lineColor: d[11],
            lineWidth: d[12],
            zIndex: d[13],
            snapInterval: !!d[14],
            linkedSheetAwait: {id: d[15], name: d[16]},
            linkedImageAwait: {id: d[17], name: d[18]},
        });
        if (tokenFound === null) console.log(`Added a token with id ${token.id}!`);
        else console.log(`Updated token with id ${d[19]}, now id ${token.id}`);

        this.objects.tokens.push(token);

        this.checkAssets();
    }

    // adds a grid and syncs it
    addGrid(d) {
        let gridFound = null;
        for (let grid of this.objects.grids) if (grid.id === d[16]) gridFound = grid;
        if (gridFound !== null) {
            if (d[16] === d[2]) return;
            this.objects.grids.splice(this.objects.grids.indexOf(gridFound), 1);
        }

        let grid = new Grid({
            type: d[1],
            id: d[2],
            name: d[3],
            radius: d[4],
            dim: {x: d[5], y: d[6]},
            position: {x: d[7], y: d[8]},
            shape: d[9],
            lineColor: d[10],
            lineWidth: d[11],
            zIndex: d[12],
            enableGridCount: !!d[13],
            linkedImageAwait: {id: d[14], name: d[15]},
        });
        if (gridFound === null) console.log(`Added a grid with id ${grid.id}!`);
        else console.log(`Updated grid with id ${d[16]}, now id ${grid.id}`);

        this.objects.grids.push(grid);

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

        if (player.socket.id === this.host.socket.id) {
            player.host = true;
            this.host = player;
        }

        player.talk(ptools.encodePacket([protocol.client.successfulLobbyRequest, this.code, player.id], ["int8", "string", "int32"]));

        this.checkAssets();
    }

    // removes a player from the lobby
    removePlayer(player) {
        if (this.players.indexOf(player) !== -1) {
            this.players.splice(this.players.indexOf(player), 1);
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
                player.mouseColor,
                player.inMenu ? 1 : 0,
                player.host ? 1 : 0,
            );
        }
        sending.push(0);

        // send the newest locations of all tokens
        sending.push(this.objects.tokens.length);
        for (let token of this.objects.tokens) {
            sending.push(token.id, token.name, token.position.x, token.position.y);
        }
        sending.push(0);

        // send what grids exist for loading purposes
        sending.push(this.objects.grids.length);
        for (let grid of this.objects.grids) {
            sending.push(grid.id, grid.name);
        }
        sending.push(0);

        for (let player of this.players) {
            player.talk(ptools.encodePacket(sending, [
                "int8",
                "repeat", "int32", "float32", "float32", "string", "int8", "int8", "end",
                "repeat", "int32", "string", "float32", "float32", "end",
                "repeat", "int32", "string", "end"
            ]));
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
        this.inMenu = false;
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

        this.type = p.type ?? "grid";
        this.id = p.id ?? Math.floor(Math.random() * 2**31);

        this.radius = p.radius ?? 50;
        this.lineWidth = p.lineWidth ?? 2;
        this.lineColor = p.lineColor ?? "red";
        this.dim = p.dim ?? {x: 10, y: 10};
        this.shape = p.shape ?? "square";
        this.zIndex = p.zIndex ?? 0;
        this.enableGridCount = p.enableGridCount ?? false;

        this.imageOffset = p.imageOffset ?? {x: 0, y: 0};
        this.linkedImage = p.linkedImage ?? null;
        this.linkedImageAwait = p.linkedImageAwait ?? {id: -1, name: ""};
    }

    toExport() {
        return [
            this.type,
            this.id,
            this.name,
            this.radius,
            this.dim.x,
            this.dim.y,
            this.position.x,
            this.position.y,
            this.shape,
            this.lineColor,
            this.lineWidth,
            this.zIndex,
            this.enableGridCount ? 1 : 0,
            this.linkedImageAwait.id,
            this.linkedImageAwait.name
        ];
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
        this.snapInterval = p.snapInterval ?? false;

        this.linkedSheet = p.linkedSheet ?? null;
        this.linkedSheetAwait = p.linkedSheetAwait ?? {id: -1, name: ""};
        this.linkedImage = p.linkedImage ?? null;
        this.linkedImageAwait = p.linkedImageAwait ?? {id: -1, name: ""};

        this.grabbingPlayer = null;
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
            this.snapInterval ? 1 : 0,
            this.linkedSheetAwait.id,
            this.linkedSheetAwait.name,
            this.linkedImageAwait.id,
            this.linkedImageAwait.name,
            this.grabbingPlayer ? this.grabbingPlayer.id : -1
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

                    const d = ptools.decodePacket(reader, ["int8", "string", "string", "float32"]);
                    if (Lobby.lobbyWithCode(d[2]) !== null) {
                        this.talk(ptools.encodePacket([protocol.client.lobbyWithCodeAlreadyExists], ["int8"]));
                        break;
                    }

                    this.id = d[3];
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

                    const d = ptools.decodePacket(reader, ["int8", "string", "string", "float32"]);
                    const l = Lobby.lobbyWithCode(d[2])
                    if (l === null) {
                        this.talk(ptools.encodePacket([protocol.client.noLobbyWithCode], ["int8"]));
                        break;
                    }

                    this.id = d[3];
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
                    const d = ptools.decodePacket(reader, ["int8", "float32", "float32", "float32", "float32", "int8", "string"]);
                    this.playerInstance.cameraLocation = {x: d[1], y: d[2]};
                    this.playerInstance.mouseLocation = {x: d[3], y: d[4]};
                    this.playerInstance.inMenu = !!d[5];
                    this.playerInstance.mouseColor = d[6];
                    break;
                }
                // when a client creates a token, we sync it with all players
                case protocol.server.tokenCreated: {
                    if (!this.playerLobby) return;
                    const d = ptools.decodePacket(reader, ['int8', 'string', 'int32', 'string', 'string', 'float32', 'float32', 'float32', 'string', 'int8', 'string', 'string', 'float32', 'int32', "int8", 'int32', 'string', 'int32', 'string', "int32"]);
                    this.playerLobby.addToken(d);
                    break;
                }
                // when a client sends a sanity check, make sure they have all their assets
                case protocol.server.sceneSanityCheck: {
                    if (!this.playerLobby) return;
                    this.playerLobby.checkAssets();
                    break;
                }
                // when a player grabs a token, alert all others of this, and kick the existing holder
                case protocol.server.tokenGrabbed: {
                    if (!this.playerLobby) return;
                    const d = ptools.decodePacket(reader, ["int8", "int32", "string"]);
                    const token = this.playerLobby.findAssetById(d[1], d[2]);
                    if (token === null) {
                        console.warn(`unrecognized token with id ${d[1]}`);
                        return;
                    }
                    token.grabbingPlayer = this.playerInstance;
                    for (let player of this.playerLobby.players) {
                        player.talk(ptools.encodePacket([protocol.client.tokenGrabbed, token.id, token.name, token.grabbingPlayer.id], ["int8", "int32", "string", "int32"]));
                    }
                    break;
                }
                // when a player releases a token they are holding, alert everyone of this too
                case protocol.server.tokenReleased: {
                    if (!this.playerLobby) return;
                    const d = ptools.decodePacket(reader, ["int8", "int32", "string", "float32", "float32"]);
                    const token = this.playerLobby.findAssetById(d[1], d[2]);
                    if (token === null || token.grabbingPlayer !== this.playerInstance) return;
                    token.grabbingPlayer = null;
                    token.position = {x: d[3], y: d[4]};
                    for (let player of this.playerLobby.players) {
                        player.talk(ptools.encodePacket([protocol.client.tokenReleased, token.id, token.name], ["int8", "int32", "string"]));
                    }
                    break;
                }
                // finally, as the player moves the token, update its position in real time
                case protocol.server.tokenMoved: {
                    if (!this.playerLobby) return;
                    const d = ptools.decodePacket(reader, ["int8", "int32", "string", "float32", "float32"]);
                    const token = this.playerLobby.findAssetById(d[1], d[2]);
                    if (token === null || token.grabbingPlayer !== this.playerInstance) return;
                    token.position = {x: d[3], y: d[4]};
                    break;
                }
                case protocol.server.assetInquiry: {
                    if (!this.playerLobby) return;
                    const d = ptools.decodePacket(reader, ["int8", "int32", "string"]);
                    if (this.playerLobby.findAssetById(d[1], d[2]) === null) {
                        this.talk(ptools.encodePacket([protocol.client.assetSendRequest, d[1], d[2]], ["int8", "int32", "string"]));
                    }
                    break;
                }
                // when a client creates a grid, sync it with everyone
                case protocol.server.gridCreated: {
                    if (!this.playerLobby) return;
                    const d = ptools.decodePacket(reader, ["int8", "string", "int32", "string", "float32", "float32", "float32", "float32", "float32", "string", "string", "float32", "int32", "int8", "int32", "string", "int32"]);
                    this.playerLobby.addGrid(d);
                    break;
                }
                // unloads and object
                case protocol.server.deleteObject: {
                    const d = ptools.decodePacket(reader, ["int8", "int32", "string"]);
                    const obj = this.playerLobby.findAssetById(d[1], d[2]);
                    if (obj === null) return;
                    switch (obj.type) {
                        case "token": {
                            if (this.playerLobby.objects.tokens.indexOf(obj) !== -1) {
                                this.playerLobby.objects.tokens.splice(this.playerLobby.objects.tokens.indexOf(obj), 1);
                                console.log("begone foul scum")
                            }
                            break;
                        }
                        case "grid": {
                            if (this.playerLobby.objects.grids.indexOf(obj) !== -1) {
                                this.playerLobby.objects.grids.splice(this.playerLobby.objects.grids.indexOf(obj), 1);
                            }
                            break;
                        }
                    }
                    break;
                }
                case protocol.server.loadNewMap: {
                    if (!this.playerLobby) return;
                    if (!this.playerInstance.host) return;
                    this.playerLobby.objects.tokens = [];
                    this.playerLobby.objects.grids = [];
                    console.log(`Lobby with code ${this.playerLobby.code} has imported a new map!`);
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

// uses our credentials to create an https server
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
    console.log("Server running on port 8443");
});
const site = ((port, connect) => {
    WebSocket(app);
    
    app.ws("/ws", connect);
    
    app.use(compression());
    //app.use(minify());
    app.use(cors());
    app.use(express.static("public"));
    app.use(express.json());
    
    app.listen(port, () => console.log("Express is now active on port %s", port));
    return (directory, callback) => app.get(directory, callback);
  })(3000, sockets.connect);
  
  app.use(express.static("public"));
  app.get("/", (req, res) => {
      res.sendFile(__dirname + "/public/index.html");
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