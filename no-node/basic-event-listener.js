// Some remark for the future
// If we create new node-red nodes
// Store event hubs into an array and when node closes, loop on it to unregister all eventHubs
var Fabric_Client = require('fabric-client');

var fs = require('fs');

const networkInfo = {
    channelName:"defaultchannel",
    chaincodeName: "identity-manager",
    eventName: "createIdentity",
    identityName: "admin",
    orgName: "org1",
    peerName: "peer1",
    walletLocation: "./config/hfc-key-store",
    startBlock: 0,
    endBlock: 70,
    connectionProfile: JSON.parse(fs.readFileSync('./config/creds.json'))
}

listenForEvent(networkInfo);


async function listenForEvent(networkInfo) {
    var peerConnection = await connectToPeer(networkInfo.identityName, networkInfo.channelName, networkInfo.orgName, networkInfo.peerName, networkInfo.connectionProfile, networkInfo.walletLocation);
    await subscribeToEvent(peerConnection.peer, peerConnection.channel, networkInfo.chaincodeName, networkInfo.eventName, networkInfo.startBlock, networkInfo.endBlock, handleEvent);
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
async function connectToPeer(identityName, channelName, orgName, peerName, connectionProfile, walletLocation) {
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

/**
   * Subscribe to an event, pass them into the callback for processing
   * @function subscribeToEvent
   * @param {object} peer The peer to use to listen for events
   * @param {object} channel The channel to use to create an event hub
   * @param {string} chaincodeName The name of the chaincode
   * @param {string} eventName The name of the event
   * @param {int} startBlock The number of the block to start listenning
   * @param {int} endBlock DO NOT USE YET
   * @param {function} eventCallback The function to execute when receiving an event
   */
async function subscribeToEvent(peer, channel, chaincodeName, eventName, startBlock, endBlock, eventCallback) {
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
            startBlock: startBlock
        });
    eventHub.connect(true);
}

function handleEvent(event){
    console.log("We do something with the event--------");
    console.log(event);
}