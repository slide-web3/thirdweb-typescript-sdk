import {
  FilledSignaturePayload721,
  MintRequest721,
  PayloadToSign721,
  PayloadWithUri721,
  Signature721PayloadInput,
  Signature721PayloadOutput,
  SignedPayload721,
} from "../../schema/contracts/common/signature";
import { TransactionResultWithId } from "../types";
import { normalizePriceValue, setErc20Allowance } from "../../common/currency";
import { BigNumber } from "ethers";
import invariant from "tiny-invariant";
import { ContractWrapper } from "./contract-wrapper";
import { ITokenERC721, TokenERC721 } from "contracts";
import { IStorage } from "../interfaces";
import { ContractRoles } from "./contract-roles";
import { NFTCollection } from "../../contracts";
import { uploadOrExtractURIs } from "../../common/nft";
import { TokensMintedWithSignatureEvent } from "contracts/ITokenERC721";

/**
 * Enables generating dynamic ERC721 NFTs with rules and an associated signature, which can then be minted by anyone securely
 * @public
 */
// TODO consolidate into a single class
export class Erc721SignatureMinting {
  private contractWrapper: ContractWrapper<TokenERC721>;
  private storage: IStorage;
  private roles: ContractRoles<
    TokenERC721,
    typeof NFTCollection.contractRoles[number]
  >;

  constructor(
    contractWrapper: ContractWrapper<TokenERC721>,
    roles: ContractRoles<
      TokenERC721,
      typeof NFTCollection.contractRoles[number]
    >,
    storage: IStorage,
  ) {
    this.contractWrapper = contractWrapper;
    this.storage = storage;
    this.roles = roles;
  }

  /**
   * Mint a dynamically generated NFT
   *
   * @remarks Mint a dynamic NFT with a previously generated signature.
   *
   * @example
   * ```javascript
   * // see how to craft a payload to sign in the `generate()` documentation
   * const signedPayload = contract.signature.generate(payload);
   *
   * // now anyone can mint the NFT
   * const tx = contract.signature.mint(signedPayload);
   * const receipt = tx.receipt; // the mint transaction receipt
   * const mintedId = tx.id; // the id of the NFT minted
   * ```
   * @param signedPayload - the previously generated payload and signature with {@link Erc721SignatureMinting.generate}
   */
  public async mint(
    signedPayload: SignedPayload721,
  ): Promise<TransactionResultWithId> {
    const mintRequest = signedPayload.payload;
    const signature = signedPayload.signature;
    const message = await this.mapPayloadToContractStruct(mintRequest);
    const overrides = await this.contractWrapper.getCallOverrides();
    await setErc20Allowance(
      this.contractWrapper,
      BigNumber.from(message.price),
      mintRequest.currencyAddress,
      overrides,
    );
    const receipt = await this.contractWrapper.sendTransaction(
      "mintWithSignature",
      [message, signature],
      overrides,
    );
    const t = this.contractWrapper.parseLogs<TokensMintedWithSignatureEvent>(
      "TokensMintedWithSignature",
      receipt.logs,
    );
    if (t.length === 0) {
      throw new Error("No MintWithSignature event found");
    }
    const id = t[0].args.tokenIdMinted;
    return {
      id,
      receipt,
    };
  }

  /**
   * Mint any number of dynamically generated NFT at once
   * @remarks Mint multiple dynamic NFTs in one transaction. Note that this is only possible for free mints (cannot batch mints with a price attached to it for security reasons)
   * @param signedPayloads - the array of signed payloads to mint
   */
  public async mintBatch(
    signedPayloads: SignedPayload721[],
  ): Promise<TransactionResultWithId[]> {
    const contractPayloads = await Promise.all(
      signedPayloads.map(async (s) => {
        const message = await this.mapPayloadToContractStruct(s.payload);
        const signature = s.signature;
        const price = s.payload.price;
        if (BigNumber.from(price).gt(0)) {
          throw new Error(
            "Can only batch free mints. For mints with a price, use regular mint()",
          );
        }
        return {
          message,
          signature,
        };
      }),
    );
    const encoded = contractPayloads.map((p) => {
      return this.contractWrapper.readContract.interface.encodeFunctionData(
        "mintWithSignature",
        [p.message, p.signature],
      );
    });
    const receipt = await this.contractWrapper.multiCall(encoded);
    const events =
      this.contractWrapper.parseLogs<TokensMintedWithSignatureEvent>(
        "TokensMintedWithSignature",
        receipt.logs,
      );
    if (events.length === 0) {
      throw new Error("No MintWithSignature event found");
    }
    return events.map((log) => ({
      id: log.args.tokenIdMinted,
      receipt,
    }));
  }

  /**
   * Verify that a payload is correctly signed
   * @param signedPayload - the payload to verify
   */
  public async verify(signedPayload: SignedPayload721): Promise<boolean> {
    const mintRequest = signedPayload.payload;
    const signature = signedPayload.signature;
    const message = await this.mapPayloadToContractStruct(mintRequest);
    const verification: [boolean, string] =
      await this.contractWrapper.readContract.verify(message, signature);
    return verification[0];
  }

  /**
   * Generate a signature that can be used to mint a dynamic NFT
   *
   * @remarks Takes in an NFT and some information about how it can be minted, uploads the metadata and signs it with your private key. The generated signature can then be used to mint an NFT using the exact payload and signature generated.
   *
   * @example
   * ```javascript
   * const nftMetadata = {
   *   name: "Cool NFT #1",
   *   description: "This is a cool NFT",
   *   image: fs.readFileSync("path/to/image.png"), // This can be an image url or file
   * };
   *
   * const startTime = new Date();
   * const endTime = new Date(Date.now() + 60 * 60 * 24 * 1000);
   * const payload = {
   *   metadata: nftMetadata, // The NFT to mint
   *   to: {{wallet_address}}, // Who will receive the NFT (or AddressZero for anyone)
   *   price: 0.5, // the price to pay for minting
   *   currencyAddress: NATIVE_TOKEN_ADDRESS, // the currency to pay with
   *   mintStartTime: startTime, // can mint anytime from now
   *   mintEndTime: endTime, // to 24h from now,
   *   royaltyRecipient: "0x...", // custom royalty recipient for this NFT
   *   royaltyBps: 100, // custom royalty fees for this NFT (in bps)
   *   primarySaleRecipient: "0x...", // custom sale recipient for this NFT
   * };
   *
   * const signedPayload = contract.signature.generate(payload);
   * // now anyone can use these to mint the NFT using `contract.signature.mint(signedPayload)`
   * ```
   * @param mintRequest - the payload to sign
   * @returns the signed payload and the corresponding signature
   */
  public async generate(
    mintRequest: PayloadToSign721,
  ): Promise<SignedPayload721> {
    return (await this.generateBatch([mintRequest]))[0];
  }

  /**
   * Genrate a batch of signatures that can be used to mint many dynamic NFTs.
   *
   * @remarks See {@link Erc721SignatureMinting.generate}
   *
   * @param payloadsToSign - the payloads to sign
   * @returns an array of payloads and signatures
   */
  public async generateBatch(
    payloadsToSign: PayloadToSign721[],
  ): Promise<SignedPayload721[]> {
    await this.roles.verify(
      ["minter"],
      await this.contractWrapper.getSignerAddress(),
    );

    const parsedRequests: FilledSignaturePayload721[] = payloadsToSign.map(
      (m) => Signature721PayloadInput.parse(m),
    );

    const metadatas = parsedRequests.map((r) => r.metadata);
    const uris = await uploadOrExtractURIs(metadatas, this.storage);

    const chainId = await this.contractWrapper.getChainID();
    const signer = this.contractWrapper.getSigner();
    invariant(signer, "No signer available");

    return await Promise.all(
      parsedRequests.map(async (m, i) => {
        const uri = uris[i];
        const finalPayload = Signature721PayloadOutput.parse({
          ...m,
          uri,
        });
        const signature = await this.contractWrapper.signTypedData(
          signer,
          {
            name: "TokenERC721",
            version: "1",
            chainId,
            verifyingContract: this.contractWrapper.readContract.address,
          },
          { MintRequest: MintRequest721 },
          await this.mapPayloadToContractStruct(finalPayload),
        );
        return {
          payload: finalPayload,
          signature: signature.toString(),
        };
      }),
    );
  }

  /** ******************************
   * PRIVATE FUNCTIONS
   *******************************/

  /**
   * Maps a payload to the format expected by the contract
   *
   * @internal
   *
   * @param mintRequest - The payload to map.
   * @returns - The mapped payload.
   */
  private async mapPayloadToContractStruct(
    mintRequest: PayloadWithUri721,
  ): Promise<ITokenERC721.MintRequestStructOutput> {
    const normalizedPricePerToken = await normalizePriceValue(
      this.contractWrapper.getProvider(),
      mintRequest.price,
      mintRequest.currencyAddress,
    );
    return {
      to: mintRequest.to,
      price: normalizedPricePerToken,
      uri: mintRequest.uri,
      currency: mintRequest.currencyAddress,
      validityEndTimestamp: mintRequest.mintEndTime,
      validityStartTimestamp: mintRequest.mintStartTime,
      uid: mintRequest.uid,
      royaltyRecipient: mintRequest.royaltyRecipient,
      royaltyBps: mintRequest.royaltyBps,
      primarySaleRecipient: mintRequest.primarySaleRecipient,
    } as ITokenERC721.MintRequestStructOutput;
  }
}
