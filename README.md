- [node-red-contrib-fabric](#node-red-contrib-fabric)
  - [Nodes](#nodes)
    - [Hyperledger-Fabric-Out](#hyperledger-fabric-out)
    - [Hyperledger-Fabric-Mid](#hyperledger-fabric-mid)
    - [Hyperledger-Fabric-In](#hyperledger-fabric-in)
    - [Hyperledger-Fabric-Event-List](#hyperledger-fabric-event-list)
    - [Hyperledger-Fabric-Query](#hyperledger-fabric-query)
- [The purpose of these modifications](#the-purpose-of-these-modifications)
  - [License <a name="license"></a>](#license-a-name%22license%22a)
# node-red-contrib-fabric
A set of nodes for interacting with Hyperledger Fabric

## Nodes
### Hyperledger-Fabric-Out
A node red output node that allows you to submit or evaluate a transaction.

### Hyperledger-Fabric-Mid
A node red mid flow node that allows you to submit or evaluate a transaction and get the result.

### Hyperledger-Fabric-In
A node red input node that subscribes to events from a blockchain.

### Hyperledger-Fabric-Event-List
This node is an evolution of the Hyperledger-Fabric-In node.

A node red mid flow that allows you to subscribe to events from a blockchain.

This node can be configured manually or dynamically with the input payload. The input payload overwrites the manual configuration. 

Only the provided properties are overwritten, meaning you can use manual node configuration AND dynamic configuration at the same time.

This node allows to listen on a specific range of blocks.

This node allows to setup a two seconds timeout to unregister the event listener.

The node behave differently depending on how you use it:
- If the node is configured to listen indefinitely (no timeout, no end block), events are pushed one by one to the next node.
- If the node is configured to listen on a specific range of block (with an end block, with a timeout), it will return all events in an array to the next node, once the timeout is reached
- If the node is configured to listen on a specific range of block (with an end block, no timeout), events are pushed one by one to the next node

### Hyperledger-Fabric-Query
A node red mid flow that allows you to query the blockchain world state.

This node cand be configured dynamicaly with an input payload.

# The purpose of these modifications

We modified the [node-red-contrib-fabric node](https://github.com/floriancastelain/node-red-contrib-fabric) in order to make it fulfill our requirements for an internal project.

The requirements are:

- A node that sends transactions and wait for them to be commited (or not)
  - This is already acheived with the mid node
- A node that queries the world state
  - We need to create this node
- A node that listens for specific events on a range of blocks
  - We need to create this node
  - Remark: As [this issue](https://jira.hyperledger.org/browse/FABN-1207)  says, the listener options may be bugued. We may need to use a timeout as this is the case in custom node release [v0.0.2](https://github.com/floriancastelain/node-red-contrib-fabric/releases/tag/v0.0.2)



## License <a name="license"></a>
Hyperledger Project source code files are made available under the Apache License, Version 2.0 (Apache-2.0), located in the [LICENSE](LICENSE.txt) file. Hyperledger Project documentation files are made available under the Creative Commons Attribution 4.0 International License (CC-BY-4.0), available at http://creativecommons.org/licenses/by/4.0/.
