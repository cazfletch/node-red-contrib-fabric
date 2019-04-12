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

    const eventHandlers = [];
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
    async function subscribeToEvents(channelName, contractName, eventName = '.*', node, startBlock, endBlock) {
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
                //ENHANCE: here we can return block number (see register function params)
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
            }, {
                    //ENHANCE : Give the possibility to listen from/to specific blocks
                    startBlock: startBlock,
                    endBlock: endBlock,
                    disconnect: false
                });

            eventHandlers.push(eventHandler);
            node.log('added event handler to list');
        });
    }

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
                node.error('Error: ' + error.message);
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
                node.error('Error: ' + error.message);
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

        // node.log('config ' + util.inspect(node.connection, false, null));
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
                await connect(node.connection.identityName, config.channelName, config.contractName, node);
                const network = await gateway.getNetwork(config.channelName);
                const channel = network.getChannel();
                const inputRequestAsJson = JSON.parse(config.request);
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
                node.error('Error: ' + error.message);
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


};

