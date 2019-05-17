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
        return contract.submitTransaction(payload.transactionName, ...payload.transactionArgs);
    }

    /**
     * @param {object} channel the channel object
     * @param {object} payload payload
     * @param {string} contractName the name of the contrat
     * @param {Node} node node
     * @returns {Promise<Buffer>} promise
     */
    function query(channel, payload, contractName, node) {
        node.log(`query ${contractName} ${payload.queryFcn} ${payload.queryArgs}`);
        return channel.queryByChaincode({
            chaincodeId: contractName,
            fcn: payload.queryFcn,
            args: payload.queryArgs
        });
    }

    /**
     * @param {string} channelName the name of the channel
     * @param {string} contractName the name of the contract
     * @param {string} eventName the name of the event
     * @param {Node} node node
     * @returns {Promise<Buffer>} promise
     */
    async function subscribeToEvents(channelName, contractName, eventName = '.*', node) {
        node.log(`subscribe ${channelName} ${contractName} ${eventName}`);
        const network = await gateway.getNetwork(channelName);
        const channel = network.getChannel();
        node.log('got channel');
        const eventHubs = channel.getChannelEventHubsForOrg();
        node.log('got event hubs');
        eventHubs.forEach((eventHub) => {
            eventHub.connect(true);
            node.log('connected to event hub');
            const eventHandler = eventHub.registerChaincodeEvent(contractName, eventName, (event, blockNumber, txid, status) => {
                node.log('got event ' + event.event_name + ' ' + event.payload);
                const msg = {
                    eventName: event.event_name,
                    payload: event.payload,
                    blockNumber: blockNumber,
                    txid: txid,
                    status: status
                };
                node.status({});
                node.send(msg);
            }, (error) => {
                node.log('error', error);
                throw new Error(error.message);
            }, {});

            eventHandlers.push(eventHandler);
            node.log('added event handler to list');
        });
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
     * An event subscriber that subscribes to only one event and closes after a 2sec timeout if required
     * It also can listen on an interval of blocks, useful in cases you do not want to keep listenning
     * Sends all the events in an array or one by one in the msg.payload depending on the configuration
     * @param {peer} peer The peer to connect to
     * @param {channel} channel The channel on which create the event hub
     * @param {string} chaincodeName The name of the chaincode
     * @param {Node} node node
     * @param {object} msg the msg object
     * @returns {Promise<Buffer>} promise
     */
    async function subscribeToEvent(peer, channel, chaincodeName, node, msg) {
        let eventHub = channel.newChannelEventHub(peer);
        let startBlock = parseInt(msg.payload.startBlock);
        let endBlock = parseInt(msg.payload.endBlock);
        let timeout = msg.payload.timeout === undefined ? true : msg.payload.timeout;
        let options = {};
        // In case the user did not provide the field
        if (isNaN(startBlock)) {
            options.startBlock = 0;
        } else {
            options.startBlock = startBlock;
        }
        if (!isNaN(endBlock)) {
            options.endBlock = endBlock;
            //https://jira.hyperledger.org/browse/FABN-1207
            //Required due to bug
            options.disconnect = false;
        }
        let event = null;
        let eventList = [];
        timeout = timeout === 'true' ? true : false;
        if (timeout) {
            var eventTimeout = setTimeout(() => {
                if (event) {
                    eventHub.unregisterChaincodeEvent(event);
                    node.log('Unregistered chaincode event');
                    msg.payload = eventList;
                    node.send(msg);
                }
                node.log('Timed out for chaincode event (Expected)');
            }, 2000);
        }

        node.log('Event listener options: ' + JSON.stringify(options));
        event = eventHub.registerChaincodeEvent(chaincodeName, msg.payload.eventName, (event, blockNumber, txid, status) => {
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
     *
     * @param {string} identityName identityName
     * @param {string} channelName channel
     * @param {string} orgName name of the organization
     * @param {string} peerName name of the peer
     * @param {object} connection the connection config
     * @param {string} walletLocation the wallet location (the files, not the folder)
     * @returns {PromiseLike<Contract | never>} promise
     */
    async function connectToPeer(identityName, channelName,
        orgName, peerName, connection) {
        try {
            var connectionProfile = JSON.parse(connection.connectionProfile);
            var fabric_client = new fabricClient();
            var peer = fabric_client.newPeer(connectionProfile.peers[orgName + '-' + peerName].url, { pem: connectionProfile.peers[orgName + '-' + peerName].tlsCACerts.pem, 'ssl-target-name-override': null });
            var channel = fabric_client.newChannel(channelName);
            channel.addPeer(peer);
            var stateStore = await fabricClient.newDefaultKeyValueStore({
                path: connection.walletLocation + `\\${identityName}`
            });
            fabric_client.setStateStore(stateStore);
            var cryptoSuite = fabricClient.newCryptoSuite();
            var cryptoStore = fabricClient.newCryptoKeyStore({ path: connection.walletLocation + `\\${identityName}` });
            cryptoSuite.setCryptoKeyStore(cryptoStore);
            fabric_client.setCryptoSuite(cryptoSuite);
            var userFromStore = await fabric_client.getUserContext(identityName, true);
            if (!userFromStore || !userFromStore.isEnrolled()) {
                throw new Error('User not enrolled or not from store');
            } else {
                return ({
                    channel: channel,
                    peer: peer
                });
            }
        } catch (error) {
            console.error('Error when connecting to peer');
            console.log(error);
        }
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
                } else if (actionType === 'query') {
                    const networkInfo = await connect(identityName, channelName, contractName, node);
                    result = await query(networkInfo.network.getChannel(), msg.payload, contractName, node);
                    msg.payload = result;
                    node.status({});
                    node.send(msg);
                } else if (actionType === 'event') {
                    const networkInfo = await connectToPeer(identityName, channelName, msg.payload.orgName, msg.payload.peerName, node.connection);
                    result = await subscribeToEvent(networkInfo.peer, networkInfo.channel, contractName, node, msg);
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
            .then(() => {
                return subscribeToEvents(config.channelName, config.contractName, config.eventName, node);
            })
            .catch((error) => {
                node.status({ fill: 'red', shape: 'dot', text: 'Error' });
                node.error('Error: ' + error.message);
            });
        node.on('close', () => {
            node.status({ fill: 'red', shape: 'ring', text: 'disconnected' });
            node.log('close');
            if (network) {
                node.log('got network so need to unregister');
                const channel = network.getChannel();
                const eventHubs = channel.getChannelEventHubsForOrg();
                eventHubs.forEach((eventHub) => {
                    eventHandlers.forEach((eventHandler) => {
                        node.log('unregistering from chaincode event');
                        eventHub.unregisterChaincodeEvent(eventHandler);
                    });
                });
            }
            if (gateway) {
                node.log('got gateway so disconnect');
                gateway.disconnect();
            }
            node.log('finished close');
        });
    }
    RED.nodes.registerType('fabric-in', FabricInNode);
};