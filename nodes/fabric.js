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


    // The list of the event hubs, "indexed" by the node id
    // Think of it like a C# dictionnary
    let eventHubsHandler = {};

    /**
     * An object that manages all gateways
     */
    let gateways = (function() {
        let list = {};
        /**
         * Get the gateway based on its name
         * @param {string} identityName identityName
         * @param {string} mspid mspid
         * @returns {PromiseLike<Contract | never>} promise
         */
        async function get(identityName, mspid) {
            // hasOwnProperty always returned undefined for unknown reason
            if (list[mspid + identityName] !== undefined && list[mspid + identityName] !== null) {

                return list[mspid + identityName];
            } else {
                return null;
            }
        }

        /**
         * Returns MSPID from connection profile
         * @param {Node} node node
         * @param {object} parsedProfile the parsed profile
         * @returns {PromiseLike<Contract | never>} promise
         */
        async function getMspid(node, parsedProfile) {
            const client = await fabricClient.loadFromConfig(parsedProfile);
            const mspid = client.getMspid();
            node.log('got mspid,' + mspid);
            return mspid;
        }
        /**
         * Returns parsed profile from connection
         * @param {Node} node node
         * @returns {PromiseLike<Contract | never>} promise
         */
        async function getProfile(node) {
            const parsedProfile = JSON.parse(node.connection.connectionProfile);
            node.log('loaded client from connection profile');
            return parsedProfile;
        }
        /**
         * Builds a gateway and its options
         * @param {string} identityName identityName
         * @param {string} discoveryEnabled is discovery enabled?
         * @param {string} discoveryAsLocalhost is discovery as local host enabled?
         * @param {string} mspid mspid
         * @param {object} parsedProfile parsedProfile
         * @param {Node} node node
         * @returns {PromiseLike<Contract | never>} promise
         */
        async function create(identityName, discoveryEnabled, discoveryAsLocalhost, mspid, parsedProfile, node) {
            let gateway = new fabricNetwork.Gateway();
            const wallet = new fabricNetwork.FileSystemWallet(node.connection.walletLocation);
            discoveryEnabled === 'true' ? discoveryEnabled = true : discoveryEnabled = false;
            discoveryAsLocalhost === 'true' ? discoveryAsLocalhost = true : discoveryAsLocalhost = false;
            const options = {
                wallet: wallet,
                identity: identityName,
                discovery: {
                    enabled: discoveryEnabled,
                    asLocalhost: discoveryAsLocalhost
                }
            };
            list[mspid + identityName] = {
                gate: gateway,
                options: options,
                profile: parsedProfile,
                isConnected: false
            };
            node.log('Create gateway for ' + mspid + identityName + ' from ' + node.id);
            return list[mspid + identityName];
        }

        /**
         * Connects the gateway
         * @param {object} gateway the gateway to connect
         * @param {object} node the node object
         * @returns {PromiseLike<Contract | never>} promise
         */
        async function connect(gateway, node) {
            if (!gateway.isConnected) {
                node.log('Connecting gateway');
                await gateway.gate.connect(gateway.profile, gateway.options);
                gateway.isConnected = true;
                node.log('Connected gateway');
                return gateway;
            } else {
                node.log('Gateway already connected. Skipping connection process');
                return gateway;
            }
        }
        return {
            get: get,
            create: create,
            connect: connect,
            mspid: getMspid,
            profile: getProfile
        };

    })();


    /**
     *
     * @param {string} identityName identityName
     * @param {string} discoveryEnabled is discovery enabled?
     * @param {string} discoveryAsLocalhost is dicovery as localhost enabled?
     * @param {string} channelName channel
     * @param {string} contractName contract
     * @param {Node} node node
     * @returns {PromiseLike<Contract | never>} promise
     */
    async function connect(identityName, discoveryEnabled, discoveryAsLocalhost, channelName, contractName, node) {
        node.log('Discovery in connect ' + discoveryAsLocalhost + ' ' + discoveryEnabled);
        let parsedProfile = await gateways.profile(node);
        let mspid = await gateways.mspid(node, parsedProfile);
        node.log('connect mspid ' + mspid);
        let gateway = await gateways.get(identityName, mspid);
        if (gateway === null) {
            node.log('gateway is null');
            gateway = await gateways.create(identityName, discoveryEnabled, discoveryAsLocalhost, mspid, parsedProfile, node);
        }
        await gateways.connect(gateway, node);
        const network = await gateway.gate.getNetwork(channelName);
        node.log('got network');
        const contract = await network.getContract(contractName);
        node.log('got contract');
        node.log('Using gateway with ' + JSON.parse(gateway.gate.getCurrentIdentity()).name);
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
     * A function that generates event listener on given event hub with given options
     * @param {object} hub the event hub to which attach the event
     * @param {string} chaincodeName the name of the chaincode
     * @param {string} eventName the name of the event
     * @param {object} node the node object
     * @param {object} msg the msg object
     * @param {boolean} isTimeout should the listener use a timeout
     * @param {object} timeout the timeout object
     * @param {object} options the listener options
     * @param {Array} eventList the event list array (in case of timeout)
     * @returns {object} event the event
     */
    function chaincodeEventFactory(hub, chaincodeName, eventName, node, msg, isTimeout, timeout, options, eventList) {
        let event = hub.registerChaincodeEvent(chaincodeName, eventName, (event, blockNumber, txid, status) => {
            let eventPayload = {
                payload: event.payload.toString('utf8'),
                blockNumber: blockNumber,
                txid: txid,
                status: status
            };
            if (isTimeout) {
                eventList.push(eventPayload);
                timeout.refresh();
            } else {
                // Reason: https://discourse.nodered.org/t/listener-node-same-msgid/13079/2
                let clonedMsg = RED.util.cloneMessage(msg);
                clonedMsg.payload = eventPayload;
                node.send(clonedMsg);
            }
            node.status({});
        }, (error) => {
            if (isTimeout) {
                if (timeout.done && error.message === 'ChannelEventHub has been shutdown') {
                    node.log('Expected chaincode listener shutdown');
                } else {
                    node.log(error);
                    node.status({ fill: 'red', shape: 'dot', text: 'Error' });
                    node.error(error, msg);
                }

            } else {
                console.log(error);
                node.error(error, msg);
            }
        }, options);
        return event;
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
    async function eventHubFactory(channel, peerName = '', node) {
        try {
            if (peerName === '' || peerName === undefined || peerName === null) {
                node.log('Generating event hubs for each peer of the org');
                const eventHubs = channel.getChannelEventHubsForOrg();
                eventHubs.forEach(hub => {
                    addHubToHandler(node.id, hub);
                });
                node.log(eventHubsHandler[node.id].length + ' event hubs from ' + node.id);
                return eventHubs;
            } else {
                let eventHub = channel.newChannelEventHub(peerName);
                addHubToHandler(node.id, eventHub);
                node.log('Created event hub for peer ' + peerName);
                node.log(eventHubsHandler[node.id].length + ' event hubs from ' + node.id);
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
     * @param {Array} eventHub Optional the event hub(s)
     */
    function disconnectEventHub(nodeId, eventHub) {
        if (eventHubsHandler.hasOwnProperty(nodeId)) {
            if (eventHub) {
                eventHub.forEach(hub => {
                    if (eventHubsHandler[nodeId].includes(hub)) {
                        let index = eventHubsHandler[nodeId].indexOf(hub);
                        if (index > -1) {
                            eventHubsHandler[nodeId][index].disconnect();
                            eventHubsHandler[nodeId].splice(index, 1);
                        }
                    }
                });
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
     * @param {string} peerName The name of the peer to connect to
     * @param {number} startBlock The start block
     * @param {number} endBlock The end block
     * @param {boolean} timeout The timeout
     * @param {string} eventName The event name
     * @param {Node} node node
     * @param {object} msg the msg object
     * @returns {Promise<Buffer>} promise
     */
    async function subscribeToEvent(channel, chaincodeName, peerName, startBlock, endBlock, timeout, eventName, node, msg) {
        if (msg === null) { msg = {}; }

        let eventHub = await eventHubFactory(channel, peerName, node);
        startBlock = parseInt(startBlock);
        endBlock = parseInt(endBlock);
        eventName = eventName === '' ? '.*' : eventName;
        let options = {};
        if (!isNaN(startBlock)) {
            options.startBlock = startBlock;
        }
        if (!isNaN(endBlock)) {
            options.endBlock = endBlock;
            //https://jira.hyperledger.org/browse/FABN-1207
            //Required due to bug
            options.disconnect = false;
            // Because having endBlock without startBlock crashes the listener
            if (!options.hasOwnProperty('startBlock')) {
                options.startBlock = 0;
            }
        }
        let event = null;
        let eventList = [];
        timeout = timeout === 'true' ? true : false;
        if (timeout) {
            // eslint-disable-next-line no-var
            var eventTimeout = setTimeout(() => {
                node.log('Expected timeout for chaincode event listener(s)');
                if (event) {
                    eventTimeout.done = true;
                    disconnectEventHub(node.id, Array.isArray(eventHub) ? eventHub : [eventHub]);
                    node.log('Unregistered chaincode event listener(s)');
                    msg.payload = eventList;
                    node.log(eventHubsHandler[node.id].length + ' event hubs from ' + node.id);
                    node.send(msg);
                }

            }, 2000);
            eventTimeout.done = false;
        }

        node.log('Event listener options: ' + JSON.stringify(options) + ' ' + eventName + ' ' + chaincodeName);
        if (Array.isArray(eventHub)) {
            eventHub.forEach(hub => {
                event = chaincodeEventFactory(hub, chaincodeName, eventName, node, msg, timeout, eventTimeout, options, eventList);
                hub.connect(true);
                node.log('Registered event listener');
            });
        } else {
            event = chaincodeEventFactory(eventHub, chaincodeName, eventName, node, msg, timeout, eventTimeout, options, eventList);
            eventHub.connect(true);
            node.log('Registered event listener');
        }
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
                const connectData = await connect(identityName, node.connection.discoveryEnabled, node.connection.discoveryAsLocalhost, config.channelName, config.contractName, node);
                if (config.actionType === 'submit') {
                    await submit(connectData.contract, msg.payload, node);
                } else {
                    await evaluate(connectData.contract, msg.payload, node);
                }
                node.status({});

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
                const identityName = node.connection.identityName;
                const channelName = typeof msg.payload.channelName === 'string' ? msg.payload.channelName : config.channelName;
                const contractName = typeof msg.payload.contractName === 'string' ? msg.payload.contractName : config.contractName;
                const actionType = typeof msg.payload.actionType === 'string' ? msg.payload.actionType : config.actionType;
                node.log('CONFIG => ' + channelName + ' ' + contractName + ' ' + actionType);
                node.log('using connection: ' + identityName);
                if (actionType === 'submit') {
                    const networkInfo = await connect(identityName, node.connection.discoveryEnabled, node.connection.discoveryAsLocalhost, channelName, contractName, node);
                    const result = await submit(networkInfo.contract, msg.payload, node);
                    msg.payload = result;
                    node.status({});
                    node.send(msg);
                } else if (actionType === 'evaluate') {
                    const networkInfo = await connect(identityName, node.connection.discoveryEnabled, node.connection.discoveryAsLocalhost, channelName, contractName, node);
                    const result = await evaluate(networkInfo.contract, msg.payload, node);
                    msg.payload = result;
                    node.status({});
                    node.send(msg);
                } else if (actionType === 'event') {
                    const networkInfo = await connect(identityName, node.connection.discoveryEnabled, node.connection.discoveryAsLocalhost, channelName, contractName, node);
                    const channel = networkInfo.network.getChannel();
                    await subscribeToEvent(channel, contractName, msg.payload.peerName, msg.payload.startBlock,
                        msg.payload.endBlock, msg.payload.timeout, msg.payload.eventName, node, msg);
                } else if (actionType === 'block') {
                    const networkInfo = await connect(identityName, node.connection.discoveryEnabled, node.connection.discoveryAsLocalhost, channelName, contractName, node);
                    const channel = networkInfo.network.getChannel();
                    const result = await queryBlock(channel, msg.payload.blockNumber);
                    msg.payload = result;
                    node.send(msg);
                    node.status({});
                } else if (actionType === 'transaction') {
                    const networkInfo = await connect(identityName, node.connection.discoveryEnabled, node.connection.discoveryAsLocalhost, channelName, contractName, node);
                    const channel = networkInfo.network.getChannel();
                    const result = await queryTransaction(channel, msg.payload.transactionId);
                    msg.payload = result;
                    node.send(msg);
                    node.status({});
                }
            } catch (error) {
                node.status({ fill: 'red', shape: 'dot', text: 'Error' });
                node.error('Error: ' + error.message, msg);
            }
        });
        node.on('close', () => {
            node.log('Node is closing');
            if (eventHubsHandler.hasOwnProperty(node.id)) {
                node.log('Disconnecting event hubs generated by node ' + node.id);
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
        connect(identityName, node.connection.discoveryEnabled, node.connection.discoveryAsLocalhost, config.channelName, config.contractName, node)
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
