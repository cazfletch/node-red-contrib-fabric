// Some remark for the future
// If we create new node-red nodes
// Store event hubs into an array and when node closes, loop on it to unregister all eventHubs
var Fabric_Client = require('fabric-client');

var fs = require('fs');

const networkInfo = {
    channelName: "defaultchannel",
    chaincodeName: "identity-manager",
    eventName: "createIdentity",
    identityName: "admin",
    orgName: "org1",
    peerName: "peer1",
    walletLocation: "./config/hfc-key-store",
    startBlock: 0,
    endBlock: 30,
    connectionProfile: JSON.parse(fs.readFileSync('./config/creds.json')),
    query: {
        chaincodeId: 'identity-manager',
        fcn: 'query',
        args: ['google.112031277188763102385']
    },
    richQuery: {
        chaincodeId: 'identity-manager',
        fcn: 'richQuery',
        args: [
            JSON.stringify({ "selector": { "email": "castelainflorian44@ibm.com" } })
        ]
    }
}


//richQueryChaincode(networkInfo);

listenForEvent(networkInfo);
//queryChaincode(networkInfo);

async function queryChaincode(networkInfo) {
    var peerConnection = await connectToPeer(networkInfo.identityName, networkInfo.channelName, networkInfo.orgName, networkInfo.peerName, networkInfo.connectionProfile, networkInfo.walletLocation);
    await queryWorldState(networkInfo.query, peerConnection.channel);
}

async function listenForEvent(networkInfo) {
    var peerConnection = await connectToPeer(networkInfo.identityName, networkInfo.channelName, networkInfo.orgName, networkInfo.peerName, networkInfo.connectionProfile, networkInfo.walletLocation);
    await subscribeToEvent(peerConnection.peer, peerConnection.channel, networkInfo.chaincodeName, networkInfo.eventName, networkInfo.startBlock, networkInfo.endBlock, handleEvent);
}
async function richQueryChaincode(networkInfo) {
    var peerConnection = await connectToPeer(networkInfo.identityName, networkInfo.channelName, networkInfo.orgName, networkInfo.peerName, networkInfo.connectionProfile, networkInfo.walletLocation);
    await richQueryWorldState(networkInfo.richQuery, peerConnection.channel);
}


/**
   * Connect to a peer of the blockchain network
   * @function connectToPeer
   * @param {string} identityName The name of the identity to use
   * @param {string} channelName The name of the channel to listen on
   * @param {string} orgName The name of the organization to which the peer belongs
   * @param {string} peerName The name of the peer to connect to
   * @param {object} connectionProfile The connection profile to use
   * @param {string} walletLocation The path to the wallet folder
   * @returns {Promise<{channel: Client.Channel;peer: Client.Peer;}>} promise
   */
async function connectToPeer(identityName, channelName, 
    orgName, peerName, connectionProfile, walletLocation) {
    try {
        var fabric_client = new Fabric_Client();
        var peer = fabric_client.newPeer(connectionProfile.peers[orgName + '-' + peerName].url, { pem: connectionProfile.peers[orgName + '-' + peerName].tlsCACerts.pem, 'ssl-target-name-override': null });
        var channel = fabric_client.newChannel(channelName);
        channel.addPeer(peer);
        var stateStore = await Fabric_Client.newDefaultKeyValueStore({
            path: walletLocation
        });
        fabric_client.setStateStore(stateStore);
        var cryptoSuite = Fabric_Client.newCryptoSuite();
        var cryptoStore = Fabric_Client.newCryptoKeyStore({ path: walletLocation });
        cryptoSuite.setCryptoKeyStore(cryptoStore);
        fabric_client.setCryptoSuite(cryptoSuite);
        var userFromStore = await fabric_client.getUserContext(identityName, true);
        if (!userFromStore || !userFromStore.isEnrolled()) {
            throw new Error("User not enrolled or not from store");
        } else {
            return ({
                channel: channel,
                peer: peer
            });
        }
    } catch (error) {
        console.error("Error when connecting to peer");
        console.log(error);
    }


}

//TODO: Currently the eventHub does not stop itself after reaching the endBlock, find a way to stop it when it reaches the endBlock
/**
   * Subscribe to an event, pass them into the callback for processing
   * @function subscribeToEvent
   * @param {object} peer The peer to use to listen for events
   * @param {object} channel The channel to use to create an event hub
   * @param {string} chaincodeName The name of the chaincode
   * @param {string} eventName The name of the event
   * @param {int} startBlock The number of the block to start listenning
   * @param {int} endBlock The last block to listen to. Afterwards, the listenner should stop
   * @param {function} eventCallback The function to execute when receiving an event
   */
async function subscribeToEvent(peer, channel, chaincodeName, 
    eventName, startBlock, endBlock, eventCallback) {
    let eventHub = channel.newChannelEventHub(peer);

    event = eventHub.registerChaincodeEvent(chaincodeName, eventName, (event, blockNumber, txid, status) => {
        var eventData = {
            payload: event.payload.toString('utf8'),
            blockNumber: blockNumber,
            txid: txid,
            status: status
        };
        eventCallback(eventData);
    }, (error) => {
        console.log(error);
        throw new Error(error);
    }, {
            startBlock: startBlock,
            endBlock: endBlock,
            disconnect: false
        });
    eventHub.connect(true);
}

// Should be node.send()
function handleEvent(event) {
    console.log("We do something with the event--------");
    console.log(event);
}

function handleQuery(response) {
    console.log("QUERY RESPONSE ");
    console.log(JSON.stringify(JSON.parse(Buffer.from(JSON.parse(response[0])).toString())));
}
function handleRichQuery(response) {
    console.log("RICHQUERY RESPONSE ");
    console.log(response.toString());
}

/**
   * Query the ledger. Used to send QUERIES, NOT TRANSACTIONS
   * Can be used for simple and rich queries
   * @function queryWorldState
   * @param {object} request The request, must contain the 'fcn', 'chaincodeId' and 'args'[] properties
   * @param {object} channel The channel to query

   */
async function queryWorldState(request, channel) {
    console.log(request);
    var queryResponse = await channel.queryByChaincode(request);
    handleQuery(queryResponse);
}

async function richQueryWorldState(request, channel) {
    console.log(request);
    var queryResponse = await channel.queryByChaincode(request);
    handleRichQuery(queryResponse);
}