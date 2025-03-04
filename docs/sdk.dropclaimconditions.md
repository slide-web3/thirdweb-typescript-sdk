<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@thirdweb-dev/sdk](./sdk.md) &gt; [DropClaimConditions](./sdk.dropclaimconditions.md)

## DropClaimConditions class

Manages claim conditions for NFT Drop contracts

<b>Signature:</b>

```typescript
export declare class DropClaimConditions<TContract extends DropERC721 | DropERC20 | BaseClaimConditionERC721> 
```

## Constructors

|  Constructor | Modifiers | Description |
|  --- | --- | --- |
|  [(constructor)(contractWrapper, metadata, storage)](./sdk.dropclaimconditions._constructor_.md) |  | Constructs a new instance of the <code>DropClaimConditions</code> class |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [canClaim(quantity, addressToCheck)](./sdk.dropclaimconditions.canclaim.md) |  | Can Claim |
|  [getActive()](./sdk.dropclaimconditions.getactive.md) |  | Get the currently active claim condition |
|  [getAll()](./sdk.dropclaimconditions.getall.md) |  | Get all the claim conditions |
|  [getClaimIneligibilityReasons(quantity, addressToCheck)](./sdk.dropclaimconditions.getclaimineligibilityreasons.md) |  | For any claim conditions that a particular wallet is violating, this function returns human readable information about the breaks in the condition that can be used to inform the user. |
|  [set(claimConditionInputs, resetClaimEligibilityForAll)](./sdk.dropclaimconditions.set.md) |  | Set public mint conditions |
|  [update(index, claimConditionInput)](./sdk.dropclaimconditions.update.md) |  | Update a single claim condition with new data. |

