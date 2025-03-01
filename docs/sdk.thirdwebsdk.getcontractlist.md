<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@thirdweb-dev/sdk](./sdk.md) &gt; [ThirdwebSDK](./sdk.thirdwebsdk.md) &gt; [getContractList](./sdk.thirdwebsdk.getcontractlist.md)

## ThirdwebSDK.getContractList() method

Return all the contracts deployed by the specified address

<b>Signature:</b>

```typescript
getContractList(walletAddress: string): Promise<{
        address: string;
        contractType: "custom" | "token" | "pack" | "split" | "edition" | "edition-drop" | "token-drop" | "vote" | "marketplace" | "nft-drop" | "signature-drop" | "multiwrap" | "nft-collection";
        metadata: () => Promise<any>;
    }[]>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  walletAddress | string | the deployed address |

<b>Returns:</b>

Promise&lt;{ address: string; contractType: "custom" \| "token" \| "pack" \| "split" \| "edition" \| "edition-drop" \| "token-drop" \| "vote" \| "marketplace" \| "nft-drop" \| "signature-drop" \| "multiwrap" \| "nft-collection"; metadata: () =&gt; Promise&lt;any&gt;; }\[\]&gt;

