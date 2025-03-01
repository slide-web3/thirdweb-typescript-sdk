<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@thirdweb-dev/sdk](./sdk.md) &gt; [Erc1155SignatureMinting](./sdk.erc1155signatureminting.md) &gt; [generate](./sdk.erc1155signatureminting.generate.md)

## Erc1155SignatureMinting.generate() method

Generate a signature that can be used to mint an NFT dynamically.

<b>Signature:</b>

```typescript
generate(payloadToSign: PayloadToSign1155): Promise<SignedPayload1155>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  payloadToSign | [PayloadToSign1155](./sdk.payloadtosign1155.md) | the payload to sign |

<b>Returns:</b>

Promise&lt;[SignedPayload1155](./sdk.signedpayload1155.md)<!-- -->&gt;

the signed payload and the corresponding signature

## Remarks

Takes in an NFT and some information about how it can be minted, uploads the metadata and signs it with your private key. The generated signature can then be used to mint an NFT using the exact payload and signature generated.

## Example


```javascript
const nftMetadata = {
  name: "Cool NFT #1",
  description: "This is a cool NFT",
  image: fs.readFileSync("path/to/image.png"), // This can be an image url or file
};

const startTime = new Date();
const endTime = new Date(Date.now() + 60 * 60 * 24 * 1000);
const payload = {
  metadata: nftMetadata, // The NFT to mint
  to: {{wallet_address}}, // Who will receive the NFT (or AddressZero for anyone)
  quantity: 2, // the quantity of NFTs to mint
  price: 0.5, // the price per NFT
  currencyAddress: NATIVE_TOKEN_ADDRESS, // the currency to pay with
  mintStartTime: startTime, // can mint anytime from now
  mintEndTime: endTime, // to 24h from now
  royaltyRecipient: "0x...", // custom royalty recipient for this NFT
  royaltyBps: 100, // custom royalty fees for this NFT (in bps)
  primarySaleRecipient: "0x...", // custom sale recipient for this NFT
};

const signedPayload = contract.signature.generate(payload);
// now anyone can use these to mint the NFT using `contract.signature.mint(signedPayload)`
```

