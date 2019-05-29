/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';
module.exports = function(RED) {
    const util = require('util');
    const fabricNetwork = require('fabric-network');
    const fabricClient = require('fabric-client');

    let eventHandlers = [];
    let gateway = new fabricNetwork.Gateway();
    let network;

    // The list of the event hubs, "indexed" by the node id
    // Think of it like a C# dictionnary
    let eventHubsHandler = {};



    /**
     *
     * @param {string} identityName identityName
     * @param {string} channelName channel
     * @param {string} contractName contract
     * @param {Node} node node
     * @returns {PromiseLike<Contract | never>} promise
     */
    async function connect(identityName, channelName, contractName, node) {
        node.log(`connect ${identityName} ${channelName} ${contractName}`);
        const parsedProfile = JSON.parse(node.connection.connectionProfile);
        const client = await fabricClient.loadFromConfig(parsedProfile);
        node.log('loaded client from connection profile');
        const mspid = client.getMspid();
        node.log('got mspid,' + mspid);
        const wallet = new fabricNetwork.FileSystemWallet(node.connection.walletLocation);
        node.log('got wallet');
        const options = {
            wallet: wallet,
            identity: identityName,
            discovery: {
                asLocalhost: true
            }
        };
        await gateway.connect(parsedProfile, options);
        node.log('connected to gateway');
        const network = await gateway.getNetwork(channelName);
        node.log('got network');
        const contract = await network.getContract(contractName);
        node.log('got contract');
        return { contract: contract, network: network };
    }

    /**
     *
     * @param {Contract} contract contract
     * @param {string} payload payload
     * @param {Node} node node
     * @returns {Promise<Buffer>} promise
     */
    function submit(contract, payload, node) {
        node.log(`submit ${payload.transactionName} ${payload.transactionArgs}`);
        return contract.submitTransaction(payload.transactionName, ...payload.transactionArgs);
    }

    /**
     *
     * @param {Contract} contract contract
     * @param {object} payload payload
     * @param {Node} node node
     * @returns {Promise<Buffer>} promise
     */
    function evaluate(contract, payload, node) {
        node.log(`evaluate ${payload.transactionName} ${payload.transactionArgs}`);
        return contract.evaluateTransaction(payload.transactionName, ...payload.transactionArgs);
    }

    /**
     *
     * @param {object} payload payload
     */
    function checkPayload(payload) {
        if (!payload.transactionName || typeof payload.transactionName !== 'string') {
            throw new Error('message should contain a transaction name of type string');
        }

        if (payload.args && !Array.isArray(payload.args)) {
            throw new Error('message args should be an array of strings');
        }
    }

    /**
     * Creates a new event hub for a given channel
     * We want this because only one event listener with start block option can be set per eventHub
     * As a work arround, we create one event hub per event listener
     * https://chat.hyperledger.org/channel/fabric-sdk-node?msg=wR4nkqvXuEWeEGDJb
     * https://gerrit.hyperledger.org/r/c/fabric-sdk-node/+/28006
     * https://fabric-sdk-node.github.io/release-1.4/tutorial-channel-events.html
     * @param {object} channel the channel 
     * @param {string} peerName the name of the peer to connect to. Empty by default. If empty, will automatically get the first peer it finds in the channel and use it as the endpoint
     * @param {object} node the node object
     * @returns {Promise<Buffer>} promise
     */
    async function eventHubFactory(channel, peerName = "", node) {
        try {
            if (peerName == "" || peerName === undefined || peerName === null) {
                node.log("No peer name provided, using first peer available on the channel")
                let peerList = channel.getChannelPeers();
                if (peerList.length > 0) {
                    let eventHub = channel.newChannelEventHub(peerList[0].getPeer());
                    node.log("Created event hub for peer " + peerList[0].getPeer().getName());
                    addHubToHandler(node.id, eventHub);
                    return eventHub;
                } else {
                    throw new Error("Could not get default peer name");
                }
            } else {
                let eventHub = channel.newChannelEventHub(peerName);
                addHubToHandler(node.id, eventHub);
                node.log("Created event hub for peer " + peerName);
                return eventHub;
            }
        } catch (error) {
            console.log(error);
            return error;
        }
    }

    // Why is this needed? Because nodes share the same "environment" and when we close a fabric node, we want to only disconnect the listeners generated by the node to close, not all the listeners.

    /**
     * Utility function not to overload the code. Stores the event hub object and "indexes" it with the fabric node that created it.
     * @param {string} nodeId the id of the node
     * @param {object} hub the event hub
     * @returns {Promise<Buffer>} promise
     */
    function addHubToHandler(nodeId, hub) {
        if (eventHubsHandler.hasOwnProperty(nodeId)) {
            eventHubsHandler[nodeId].push(hub);
        } else {
            eventHubsHandler[nodeId] = [hub];
        }
    }
    /**
     * Utility function not to overload the code. Disconect all event hubs of a node or a specified event hub of a node
     * @param {string} nodeId the id of the node
     * @param {object} hub Optional the event hub
     * @returns {Promise<Buffer>} promise
     */
    function disconnectEventHub(nodeId, eventHub) {
        if (eventHubsHandler.hasOwnProperty(nodeId)) {
            if (eventHub) {
                if (eventHubsHandler[nodeId].includes(eventHub)) {
                    var index = eventHubsHandler[nodeId].indexOf(eventHub);
                    if (index > -1) {
                        eventHubsHandler[nodeId][index].disconnect();
                        eventHubsHandler[nodeId].splice(index, 1);
                    }
                }
            } else {
                eventHubsHandler[nodeId].forEach(hub => {
                    hub.disconnect();
                });
            }
        }
    }

    /**
     * An event subscriber that subscribes to only one event and closes after a 2sec timeout if required
     * It also can listen on an interval of blocks, useful in cases you do not want to keep listenning
     * Sends all the events in an array or one by one in the msg.payload depending on the configuration
     * @param {channel} channel The channel on which create the event hub
     * @param {string} chaincodeName The name of the chaincode
     * @param {Node} node node
     * @param {object} msg the msg object
     * @returns {Promise<Buffer>} promise
     * TODO merge with other subscribeToEvents
     */
    async function subscribeToEvent(channel, chaincodeName, peerName, startBlock, endBlock, timeout, eventName, node, msg) {
        if (msg === null) { msg = {}; }

        let eventHub = await eventHubFactory(channel, peerName, node);
        startBlock = parseInt(startBlock);
        endBlock = parseInt(endBlock);
        eventName = eventName === "" ? ".*" : eventName;
        let options = {};
        // In case the user did not provide the field
        if (!isNaN(startBlock)) {
            options.startBlock = startBlock;
        }
        if (!isNaN(endBlock)) {
            options.endBlock = endBlock;
            //https://jira.hyperledger.org/browse/FABN-1207
            //Required due to bug
            options.disconnect = false;
            // Because having endBlock without startBlock crashes the listener
            if (!options.hasOwnProperty("startBlock")) {
                options.startBlock = 0;
            }
        }
        let event = null;
        let eventList = [];
        timeout = timeout === 'true' ? true : false;
        if (timeout) {
            var eventTimeout = setTimeout(() => {
                if (event) {
                    disconnectEventHub(node.id, eventHub);
                    node.log('Unregistered chaincode event');
                    msg.payload = eventList;
                    node.send(msg);
                }
                node.log('Timed out for chaincode event (Expected)');
            }, 2000);
        }

        node.log('Event listener options: ' + JSON.stringify(options) + " " + eventName + " " + chaincodeName);
        event = eventHub.registerChaincodeEvent(chaincodeName, eventName, (event, blockNumber, txid, status) => {
            var eventPayload = {
                payload: event.payload.toString('utf8'),
                blockNumber: blockNumber,
                txid: txid,
                status: status
            };
            // refresh timeout because we want ALL the events in the block interval
            // not only the ones in the time interval
            if (timeout) {
                eventList.push(eventPayload);
                eventTimeout.refresh();
            } else {
                msg.payload = eventPayload;
                node.send(msg);
            }
            node.status({});
        }, (error) => {
            console.log(error);
            node.error(error, msg);
        }, options);
        eventHub.connect(true);
        node.log('Registered event listener');
    }


    /**
     *
     * @param {object} channel the channel object
     * @param {string} blockNumber the number of the block to get
     * @returns {PromiseLike<Contract | never>} promise
     */
    async function queryBlock(channel, blockNumber) {
        return await channel.queryBlock(blockNumber);
    }

    /**
     *
     * @param {object} channel the channel object
     * @param {string} transactionId the identifier of the transaction to get
     * @returns {PromiseLike<Contract | never>} promise
     */
    async function queryTransaction(channel, transactionId) {
        return await channel.queryTransaction(transactionId);
    }

    /**
     * Create a output node
     * @param {object} config The configuration from the node
     * @constructor
     */
    function FabricOutNode(config) {
        let node = this;
        RED.nodes.createNode(node, config);

        node.on('input', async function(msg) {
            this.connection = RED.nodes.getNode(config.connection);
            try {
                const identityName = node.connection.identityName;
                node.log('using connection: ' + identityName);
                node.log('checking payload ' + util.inspect(msg.payload, false, null));
                checkPayload(msg.payload);
                const connectData = await connect(identityName, config.channelName, config.contractName, node);
                if (config.actionType === 'submit') {
                    await submit(connectData.contract, msg.payload, node);
                } else {
                    await evaluate(connectData.contract, msg.payload, node);
                }

            } catch (error) {
                node.status({ fill: 'red', shape: 'dot', text: 'Error' });
                node.error('Error: ' + error.message, msg);
            }
        });

        node.on('close', () => {
            node.log('closing node');
            node.status({});
        });
    }

    RED.nodes.registerType('fabric-out', FabricOutNode);

    /**
     * Create a mid node
     * @param {object} config The configuration set on the node
     * @constructor
     */
    function FabricMidNode(config) {
        let node = this;
        RED.nodes.createNode(node, config);

        node.on('input', async function(msg) {
            this.connection = RED.nodes.getNode(config.connection);
            try {
                //node.log('config ' + util.inspect(node.connection, false, null));
                const identityName = node.connection.identityName;
                var channelName = typeof msg.payload.channelName === 'string' ? msg.payload.channelName : config.channelName;
                var contractName = typeof msg.payload.contractName === 'string' ? msg.payload.contractName : config.contractName;
                var actionType = typeof msg.payload.actionType === 'string' ? msg.payload.actionType : config.actionType;
                // const connectionProfile = JSON.parse(node.connection.connectionProfile);
                node.log("CONFIG " + channelName + " " + contractName + " " + actionType);
                node.log('using connection: ' + identityName);
                let result;
                node.log('Node performing action: ' + actionType);
                if (actionType === 'submit') {
                    const networkInfo = await connect(identityName, channelName, contractName, node);
                    result = await submit(networkInfo.contract, msg.payload, node);
                    msg.payload = result;
                    node.status({});
                    node.send(msg);
                } else if (actionType === 'evaluate') {
                    const networkInfo = await connect(identityName, channelName, contractName, node);
                    result = await evaluate(networkInfo.contract, msg.payload, node);
                    msg.payload = result;
                    node.status({});
                    node.send(msg);
                } else if (actionType === 'event') {
                    // const networkInfo = await connectToPeer(identityName, channelName, msg.payload.orgName, msg.payload.peerName, node.connection);
                    const networkInfo = await connect(identityName, channelName, contractName, node);
                    var channel = networkInfo.network.getChannel();
                    result = await subscribeToEvent(channel, contractName, msg.payload.peerName, msg.payload.startBlock,
                        msg.payload.endBlock, msg.payload.timeout, msg.payload.eventName, node, msg);
                } else if (actionType === 'block') {
                    const networkInfo = await connectToPeer(identityName, channelName, msg.payload.orgName, msg.payload.peerName, node.connection);
                    result = await queryBlock(networkInfo.channel, msg.payload.blockNumber);
                    msg.payload = result;
                    node.send(msg);
                } else if (actionType === 'transaction') {
                    const networkInfo = await connectToPeer(identityName, channelName, msg.payload.orgName, msg.payload.peerName, node.connection);
                    result = await queryTransaction(networkInfo.channel, msg.payload.transactionId);
                    msg.payload = result;
                    node.send(msg);
                }
            } catch (error) {
                node.status({ fill: 'red', shape: 'dot', text: 'Error' });
                node.error('Error: ' + error.message, msg);
            }
        });
        node.on('close', () => {
            node.log("Node is closing");
            if (eventHubsHandler.hasOwnProperty(node.id)) {
                node.log("Disconnecting event hubs generated by node " + node.id);
                disconnectEventHub(node.id);
                delete eventHubsHandler[node.id];
            }
            node.status({});
        });
    }

    RED.nodes.registerType('fabric-mid', FabricMidNode);

    /**
     * Create an in node
     * @param {object} config The configuration set on the node
     * @constructor
     */
    function FabricInNode(config) {
        let node = this;
        RED.nodes.createNode(node, config);
        this.connection = RED.nodes.getNode(config.connection);
        const identityName = node.connection.identityName;
        node.log('using connection: ' + identityName);
        connect(identityName, config.channelName, config.contractName, node)
            .then((networkInfo) => {
                return subscribeToEvent(networkInfo.network.getChannel(), config.contractName, config.peerName,
                    config.startBlock, config.endBlock, config.timeout, config.eventName, node, null);
            })
            .catch((error) => {
                node.status({ fill: 'red', shape: 'dot', text: 'Error' });
                node.error('Error: ' + error.message);
            });
        node.on('close', () => {
            disconnectEventHub(node.id);
        });
    }
    RED.nodes.registerType('fabric-in', FabricInNode);
};