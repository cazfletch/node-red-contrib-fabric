- [node-red-contrib-fabric](#node-red-contrib-fabric)
  - [Nodes](#nodes)
    - [Hyperledger-Fabric-Out](#hyperledger-fabric-out)
    - [Hyperledger-Fabric-Mid](#hyperledger-fabric-mid)
    - [Hyperledger-Fabric-In](#hyperledger-fabric-in)
  - [License <a name="license"></a>](#license-a-name%22license%22a)
- [Work In Progress](#work-in-progress)
- [Custom Fabric nodes](#custom-fabric-nodes)
  - [Chaincode event: Get the block number](#chaincode-event-get-the-block-number)
# node-red-contrib-fabric
A set of nodes for interacting with Hyperledger Fabric

## Nodes
### Hyperledger-Fabric-Out
A node red output node that allows you to submit or evaluate a transaction.

### Hyperledger-Fabric-Mid
A node red mid flow node that allows you to submit or evaluate a transaction and get the result.

### Hyperledger-Fabric-In
A node red input node that subscribes to events from a blockchain.

## License <a name="license"></a>
Hyperledger Project source code files are made available under the Apache License, Version 2.0 (Apache-2.0), located in the [LICENSE](LICENSE.txt) file. Hyperledger Project documentation files are made available under the Creative Commons Attribution 4.0 International License (CC-BY-4.0), available at http://creativecommons.org/licenses/by/4.0/.

------ 

# Work In Progress
# Custom Fabric nodes

This document defines what the custom fabric code should allows us to achieve.

- [Custom Fabric nodes](#custom-fabric-nodes)
  - [Chaincode event: Get the block number](#chaincode-event-get-the-block-number)

## Chaincode event: Get the block number
When listenning for a chaincode event, we should be able to get, at the same time, the block number in which the event has been written. It is possible to do this with the registerChaincodeEvent.

Example:

 ```js
 block_reg = event_hub.registerChaincodeEvent("ibm-resource", "resourceAccessUpdate", (event, block_num, txnid, status) => {
        console.log('--------------------------------------------------------------------');
        console.log(JSON.stringify(event));
        console.log(block_num);
        console.log(txnid);
        console.log(status);
        console.log(event.payload.toString('utf-8'));
    }, (error) => {
        console.log(error);
    },
        {  }
    );

```

-----

## Chaincode event: Listen from a specific block to another specific block
In case the server goes down, we must be able to listen from a specific block.
It is possible with the following example:

 ```js
 block_reg = event_hub.registerChaincodeEvent("ibm-resource", "resourceAccessUpdate", (event, block_num, txnid, status) => {
        console.log('--------------------------------------------------------------------');
        console.log(JSON.stringify(event));
        console.log(block_num);
        console.log(txnid);
        console.log(status);
        console.log(event.payload.toString('utf-8'));
    }, (error) => {
        console.log(error);
    },
        { startBlock: 0 }
    );

```

The function (or node) should be dynamically configurable. The blocks number should be passed as parameters.

-----

## Chaincode "scanner": Scan a specific event from a specific block to another specific block

We should be able to scan the blockchain, on an interval of blocks, for a specific event.

Example:

 ```js
 block_reg = event_hub.registerChaincodeEvent("ibm-resource", "resourceAccessUpdate", (event, block_num, txnid, status) => {
        console.log('--------------------------------------------------------------------');
        console.log(JSON.stringify(event));
        console.log(block_num);
        console.log(txnid);
        console.log(status);
        console.log(event.payload.toString('utf-8'));
    }, (error) => {
        console.log(error);
    },
        { startBlock: 34,
        endBlock: 43 }
    );

```
The function (or node) should be dynamically configurable. The chaincode name, channel name, event name and blocks number should be passed as parameters.

-----

## Chaincode "scanner": Scan for a specific list of events from a specific block to another specific block

This can be achieved by providing a list of event names. Using block listenner, we could filter what we want to keep or not.

Example of block listenner: `yourpath/chaincode/public-channel/credentials/company_A/eventBlock.js`

The function (or node) should be dynamically configurable. The chaincode names, channel names, event names and blocks number should be passed as parameters.

-----

## Chaincode transaction: send a transaction

We should be able to send a transaction and to retreive the chaincode return.

Example: Check `yourpath/chaincode/public-channel/credentials/company_A/invoke.js`

-----

## Chaincode query: query the chaincode

We should be able to query the chaincode and get its return.

Example: Check: `yourpath/chaincode/public-channel/credentials/company_A/query.js`

This should be dynamically configurable. The channel name, chaincode name and query parameter should be passed as parameters.

