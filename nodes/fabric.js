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
module.exports = function (RED) {
    const util = require('util');
    const fabricNetwork = require('fabric-network');
    const fabricClient = require('fabric-client');

    var eventHubs = [];
    var eventHandlers = [];
    //const eventHandlers = [];
    let gateway = new fabricNetwork.Gateway();
    let network;

    /**
     *
     * @param {string} identityName identityName
     * @param {string} channelName channel
     * @param {string}contractName contract
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
        node.log(`submit ${payload.transactionName} ${payload.args}`);
        return contract.submitTransaction(payload.transactionName, ...payload.args);
    }

    /**
     *
     * @param {Contract} contract contract
     * @param {object} payload payload
     * @param {Node} node node
     * @returns {Promise<Buffer>} promise
     */
    function evaluate(contract, payload, node) {
        node.log(`evaluate ${payload.transactionName} ${payload.args}`);
        return contract.submitTransaction(payload.transactionName, ...payload.args);
    }

    // ENHANCE : Updated param list
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

    async function eventTEST(channelName, contractName, eventName = '.*', node, startBlock = -1, endBlock = -1) {
        node.log(`subscribe ${channelName} ${contractName} ${eventName}`);
        const network = await gateway.getNetwork(channelName);
        const channel = network.getChannel();
        node.log('got channel');

        var eventHub = channel.getChannelEventHub('org1-peer1');





        // const eventHubs = channel.getChannelEventHubsForOrg();
        // node.log('got event hubs');
        // __________________
        console.log("START BLOCK BEFORE " + startBlock);
        console.log("ENDBLOCK BEFORE " + endBlock);
        const options = {};
        if (startBlock === -1 || startBlock === "") {
            options.startBlock = 0;
        } else {
            options.startBlock = parseInt(startBlock);
            console.log("START BLOCK IS SET")
        }
        if (endBlock !== -1 && endBlock !== "") {
            options.disconnect = false;
            options.endBlock = endBlock;
            console.log("END BLOCK IS SET");
        };
        console.log("OPTIONS " + JSON.stringify(options));

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
        }, options
        /*{startBlock: 0}*/);

        eventHandlers.push(eventHandler);
        node.log('added event handler to list');
    };

    // eventHubs.forEach((eventHub) => {
    //     eventHub.connect(true);
    //     node.log('connected to event hub');
    //         const eventHandler = eventHub.registerChaincodeEvent(contractName, eventName, (event, blockNumber, txid, status) => {
    //             node.log('got event ' + event.event_name + ' ' + event.payload);
    //             const msg = {
    //                 eventName: event.event_name,
    //                 payload: event.payload,
    //                 blockNumber: blockNumber,
    //                 txid: txid,
    //                 status: status
    //             };
    //             node.status({});
    //             node.send(msg);
    //         }, (error) => {
    //             node.log('error', error);
    //             throw new Error(error.message);
    //         }, options);

    //         eventHandlers.push(eventHandler);
    //         node.log('added event handler to list');
    //     });
    // }

    /**
     *
     * @param payload
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
     * Create a output node
     * @param {object} config The configuration from the node
     * @constructor
     */
    function FabricOutNode(config) {
        let node = this;
        RED.nodes.createNode(node, config);

        node.on('input', async function (msg) {
            this.connection = RED.nodes.getNode(config.connection);
            try {
                const identityName = node.connection.identityName;
                node.log('using connection: ' + identityName);
                node.log('checking payload ' + util.inspect(msg.payload, false, null));
                checkPayload(msg.payload);
                const connectData = await connect(identityName, config.channelName, config.contractName, node);
                if (config.actionType === 'submit') {
                    await submit(connectData.contract, msg.payload, node)
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

        node.on('input', async function (msg) {
            this.connection = RED.nodes.getNode(config.connection);
            try {
                //node.log('config ' + util.inspect(node.connection, false, null));
                const identityName = node.connection.identityName;
                node.log('using connection: ' + identityName);
                node.log('checking payload ' + util.inspect(msg.payload, false, null));
                checkPayload(msg.payload);
                const connectData = await connect(identityName, config.channelName, config.contractName, node);
                let result;
                if (config.actionType === 'submit') {
                    result = await submit(connectData.contract, msg.payload, node);
                } else {
                    result = await evaluate(connectData.contract, msg.payload, node);
                }

                node.log('got a result ' + result);
                msg.payload = result;
                node.status({});
                node.send(msg);

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
    // function FabricInNode(config) {
    //     let node = this;
    //     RED.nodes.createNode(node, config);

    //     this.connection = RED.nodes.getNode(config.connection);

    //     // node.log('config ' + util.inspect(node.connection, false, null));
    //     const identityName = node.connection.identityName;
    //     node.log('using connection: ' + identityName);
    //     connect(identityName, config.channelName, config.contractName, node)
    //         .then(() => {
    //             console.log(JSON.stringify(config));
    //             return eventTEST(config.channelName, config.contractName, config.eventName, node, config.startBlock, config.endBlock);
    //         })
    //         .catch((error) => {
    //             node.status({ fill: 'red', shape: 'dot', text: 'Error' });
    //             node.error('Error: ' + error.message);
    //         });


    //     node.on('close', () => {
    //         node.status({ fill: 'red', shape: 'ring', text: 'disconnected' });
    //         node.log('close');
    //         if (network) {
    //             node.log('got network so need to unregister');
    //             const channel = network.getChannel();
    //             const eventHubs = channel.getChannelEventHubsForOrg();
    //             eventHubs.forEach((eventHub) => {
    //                 eventHandlers.forEach((eventHandler) => {
    //                     node.log('unregistering from chaincode event');
    //                     eventHub.unregisterChaincodeEvent(eventHandler);
    //                 });
    //             });
    //         }

    //         if (gateway) {
    //             node.log('got gateway so disconnect');
    //             gateway.disconnect();
    //         }

    //         node.log('finished close');
    //     });
    // }

    // RED.nodes.registerType('fabric-in', FabricInNode);



    /**
   * Create an in node
   * @param {object} config The configuration set on the node
   * @constructor
   */
    function FabricInNode(config) {
        let node = this;
        RED.nodes.createNode(node, config);

        this.connection = RED.nodes.getNode(config.connection);

        // node.log('config ' + util.inspect(node.connection, false, null));
        const identityName = node.connection.identityName;
        node.log('using connection: ' + identityName);
        const channelName = config.channelName;
        const orgName = config.orgName;
        const walletLocation = node.connection.walletLocation;
        const connectionProfile = JSON.parse(node.connection.connectionProfile);
        const peerName = config.peerName;
        const chaincodeName = config.contractName;
        const eventName = config.eventName;
        const startBlock = config.startBlock;
        const endBlock = config.endBlock;
        connectToPeer(identityName, channelName, orgName,
            peerName, connectionProfile, walletLocation)
            .then((networkData) => {
                return subscribeToEvent(networkData.peer, networkData.channel,
                    chaincodeName, eventName, startBlock, endBlock, node)
            }).catch((error) => {
                console.log(error);
                node.status({ fill: 'red', shape: 'dot', text: 'Error' });
                node.error('Error: ' + error.message);
            });
    }

    RED.nodes.registerType('fabric-in', FabricInNode);


    async function subscribeToEvent(peer, channel, chaincodeName,
        eventName, startBlock, endBlock, node) {
        let eventHub = channel.newChannelEventHub(peer);
        startBlock = parseInt(startBlock);
        endBlock = parseInt(endBlock);
        var options = {};
        if (isNaN(startBlock)) {
            options.startBlock = 0;
        } else {
            options.startBlock = startBlock;
        }
        if (!isNaN(endBlock)) {
            options.endBlock = endBlock;
            options.disconnect = false;
        }
        console.log(options);
        var event = eventHub.registerChaincodeEvent(chaincodeName, eventName, (event, blockNumber, txid, status) => {
            var msg = {
                payload: event.payload.toString('utf8'),
                blockNumber: blockNumber,
                txid: txid,
                status: status
            };
            node.status({});
            node.send(msg);
        }, (error) => {
            console.log(error);
            throw new Error(error);
        }, options);
        eventHub.connect(true);
    }

    async function connectToPeer(identityName, channelName,
        orgName, peerName, connectionProfile, walletLocation) {
        try {
            var fabric_client = new fabricClient();
            var peer = fabric_client.newPeer(connectionProfile.peers[orgName + '-' + peerName].url, { pem: connectionProfile.peers[orgName + '-' + peerName].tlsCACerts.pem, 'ssl-target-name-override': null });
            var channel = fabric_client.newChannel(channelName);
            channel.addPeer(peer);
            var stateStore = await fabricClient.newDefaultKeyValueStore({
                path: walletLocation
            });
            fabric_client.setStateStore(stateStore);
            var cryptoSuite = fabricClient.newCryptoSuite();
            var cryptoStore = fabricClient.newCryptoKeyStore({ path: walletLocation });
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

    //ENHANCE
    // query node

    /**
     * Create a query node
     * Returns the query result as is
     * In case of rich queries, do not forget to stringify the arg (selector)
     * Simple query example: {"chaincodeId":"chaincodeName","fcn":"query","args":["myarg"]}
     * Rich query example: {"chaincodeId":"chaincodeName","fcn":"richQuery","args":["{ \"selector\": { \"field\": \"fieldValue\" } }"]}
     * @param {object} config The configuration set on the node
     * @constructor
     */
    function FabricQueryNode(config) {
        let node = this;
        RED.nodes.createNode(node, config);

        node.on('input', async function (msg) {
            this.connection = RED.nodes.getNode(config.connection);
            try {
                const queryConfig = assembleQueryData(msg.payload, config);
                await connect(node.connection.identityName,
                    queryConfig.channelName,
                    queryConfig.contractName,
                    node);
                const network = await gateway.getNetwork(queryConfig.channelName);
                const channel = network.getChannel();
                const inputRequestAsJson = queryConfig.request;
                var request = {
                    chaincodeId: inputRequestAsJson.chaincodeId,
                    fcn: inputRequestAsJson.fcn,
                    args: []
                };
                for (let i = 0; i < inputRequestAsJson.args.length; i++) {
                    request.args.push(inputRequestAsJson.args[i]);
                }
                msg.payload = await channel.queryByChaincode(request);
                node.status({});
                node.send(msg);

            } catch (error) {
                node.status({ fill: 'red', shape: 'dot', text: 'Error' });
                node.error('Error: ' + error.message, msg);
            } finally {
                gateway.disconnect();
                node.log("disconnected gateway");
            }
        });

        node.on('close', () => {
            node.status({});
        });
    }
    RED.nodes.registerType('fabric-query', FabricQueryNode);

    function assembleQueryData(payload, config) {
        var data = {};
        if (typeof payload.channelName === "string") {
            data.channelName = payload.channelName;
        } else {
            data.channelName = config.channelName;
        }
        if (typeof payload.contractName === "string") {
            data.contractName = payload.contractName;
        } else {
            data.channelName = config.channelName;
        }
        if (typeof payload.request === "object") {
            data.request = payload.request;
        } else {
            data.request = config.request;
        }
        return data;
    }
};

