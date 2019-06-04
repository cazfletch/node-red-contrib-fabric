'use strict';
/**
 * Exports fabric-config node
 * @param {object} RED Provides the module access to the Node-RED runtime api
 */
module.exports = function(RED) {
    /**
     * Creates the config node
     * @param {object} n Node configuration
     */
    function FabricConfigNode(n) {
        RED.nodes.createNode(this, n);
        this.configLabel = n.configLabel;
        this.identityName = n.identityName;
        this.connectionProfile = n.connectionProfile;
        this.walletLocation = n.walletLocation;
    }
    RED.nodes.registerType('fabric-config', FabricConfigNode);
};