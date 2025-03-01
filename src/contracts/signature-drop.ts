import { ContractRoles } from "../core/classes/contract-roles";
import { SignatureDrop as SignatureDropContract } from "contracts";
import {
  BigNumber,
  BigNumberish,
  BytesLike,
  constants,
  ethers,
  utils,
} from "ethers";
import { ContractMetadata } from "../core/classes/contract-metadata";
import { ContractRoyalty } from "../core/classes/contract-royalty";
import { ContractWrapper } from "../core/classes/contract-wrapper";
import { IStorage } from "../core/interfaces/IStorage";
import {
  NetworkOrSignerOrProvider,
  TransactionResult,
  TransactionResultWithId,
} from "../core/types";
import { DropErc721ContractSchema } from "../schema/contracts/drop-erc721";
import { SDKOptions } from "../schema/sdk-options";
import {
  CommonNFTInput,
  NFTMetadata,
  NFTMetadataInput,
  NFTMetadataOwner,
} from "../schema/tokens/common";
import { DEFAULT_QUERY_ALL_COUNT, QueryAllParams } from "../types/QueryParams";
import { DropSingleClaimConditions } from "../core/classes/drop-single-claim-conditions";
import { Erc721 } from "../core/classes/erc-721";
import { ContractPrimarySale } from "../core/classes/contract-sales";
import { prepareClaim } from "../common/claim-conditions";
import { ContractEncoder } from "../core/classes/contract-encoder";
import { Erc721Enumerable } from "../core/classes/erc-721-enumerable";
import { Erc721Supply } from "../core/classes/erc-721-supply";
import { GasCostEstimator } from "../core/classes/gas-cost-estimator";
import { ClaimVerification } from "../types";
import { ContractEvents } from "../core/classes/contract-events";
import { ContractPlatformFee } from "../core/classes/contract-platform-fee";
import { ContractInterceptor } from "../core/classes/contract-interceptor";
import { getRoleHash } from "../common";
import {
  TokensClaimedEvent,
  TokensLazyMintedEvent,
} from "contracts/DropERC721";
import { ContractAnalytics } from "../core/classes/contract-analytics";
import { Erc721WithQuantitySignatureMinting } from "../core/classes/erc-721-with-quantity-signature-minting";
import { DelayedReveal } from "../core/index";

/**
 * Setup a collection of NFTs where when it comes to minting, you can authorize
 * some external party to mint tokens on your contract, and specify what exactly
 * will be minted by that external party..
 *
 * @example
 *
 * ```javascript
 * import { ThirdwebSDK } from "@thirdweb-dev/sdk";
 *
 * const sdk = new ThirdwebSDK("rinkeby");
 * const contract = sdk.getSignatureDrop("{{contract_address}}");
 * ```
 *
 * @internal
 */
export class SignatureDrop extends Erc721<SignatureDropContract> {
  static contractType = "signature-drop" as const;
  static contractRoles = ["admin", "minter", "transfer"] as const;
  static contractAbi = require("../../abis/SignatureDrop.json");
  /**
   * @internal
   */
  static schema = DropErc721ContractSchema;

  public encoder: ContractEncoder<SignatureDropContract>;
  public estimator: GasCostEstimator<SignatureDropContract>;
  public metadata: ContractMetadata<
    SignatureDropContract,
    typeof SignatureDrop.schema
  >;
  public sales: ContractPrimarySale<SignatureDropContract>;
  public platformFees: ContractPlatformFee<SignatureDropContract>;
  public events: ContractEvents<SignatureDropContract>;
  public roles: ContractRoles<
    SignatureDropContract,
    typeof SignatureDrop.contractRoles[number]
  >;
  public analytics: ContractAnalytics<SignatureDropContract>;
  /**
   * @internal
   */
  public interceptor: ContractInterceptor<SignatureDropContract>;
  /**
   * Configure royalties
   * @remarks Set your own royalties for the entire contract or per token
   * @example
   * ```javascript
   * // royalties on the whole contract
   * contract.royalties.setDefaultRoyaltyInfo({
   *   seller_fee_basis_points: 100, // 1%
   *   fee_recipient: "0x..."
   * });
   * // override royalty for a particular token
   * contract.royalties.setTokenRoyaltyInfo(tokenId, {
   *   seller_fee_basis_points: 500, // 5%
   *   fee_recipient: "0x..."
   * });
   * ```
   */
  public royalties: ContractRoyalty<
    SignatureDropContract,
    typeof SignatureDrop.schema
  >;
  /**
   * Configure claim conditions
   * @remarks Define who can claim NFTs in the collection, when and how many.
   * @example
   * ```javascript
   * const presaleStartTime = new Date();
   * const claimCondition = {
   *     startTime: presaleStartTime, // start the presale now
   *     maxQuantity: 2, // limit how many mints for this presale
   *     price: 0.01, // presale price
   *     snapshot: ['0x...', '0x...'], // limit minting to only certain addresses
   * };
   * await contract.claimCondition.set(claimCondition);
   * ```
   */
  public claimCondition: DropSingleClaimConditions<SignatureDropContract>;
  /**
   * Delayed reveal
   * @remarks Create a batch of encrypted NFTs that can be revealed at a later time.
   * @example
   * ```javascript
   * // the real NFTs, these will be encrypted until you reveal them
   * const realNFTs = [{
   *   name: "Common NFT #1",
   *   description: "Common NFT, one of many.",
   *   image: fs.readFileSync("path/to/image.png"),
   * }, {
   *   name: "Super Rare NFT #2",
   *   description: "You got a Super Rare NFT!",
   *   image: fs.readFileSync("path/to/image.png"),
   * }];
   * // A placeholder NFT that people will get immediately in their wallet, and will be converted to the real NFT at reveal time
   * const placeholderNFT = {
   *   name: "Hidden NFT",
   *   description: "Will be revealed next week!"
   * };
   * // Create and encrypt the NFTs
   * await contract.revealer.createDelayedRevealBatch(
   *   placeholderNFT,
   *   realNFTs,
   *   "my secret password",
   * );
   * // Whenever you're ready, reveal your NFTs at any time
   * const batchId = 0; // the batch to reveal
   * await contract.revealer.reveal(batchId, "my secret password");
   * ```
   */
  public revealer: DelayedReveal<SignatureDropContract>;
  /**
   * Signature Minting
   * @remarks Generate dynamic NFTs with your own signature, and let others mint them using that signature.
   * @example
   * ```javascript
   * // see how to craft a payload to sign in the `contract.signature.generate()` documentation
   * const signedPayload = contract.signature.generate(payload);
   *
   * // now anyone can mint the NFT
   * const tx = contract.signature.mint(signedPayload);
   * const receipt = tx.receipt; // the mint transaction receipt
   * const mintedId = tx.id; // the id of the NFT minted
   * ```
   */
  public signature: Erc721WithQuantitySignatureMinting;

  private _query = this.query as Erc721Supply;
  private _owned = this._query.owned as Erc721Enumerable;

  constructor(
    network: NetworkOrSignerOrProvider,
    address: string,
    storage: IStorage,
    options: SDKOptions = {},
    contractWrapper = new ContractWrapper<SignatureDropContract>(
      network,
      address,
      SignatureDrop.contractAbi,
      options,
    ),
  ) {
    super(contractWrapper, storage, options);
    this.metadata = new ContractMetadata(
      this.contractWrapper,
      SignatureDrop.schema,
      this.storage,
    );
    this.roles = new ContractRoles(
      this.contractWrapper,
      SignatureDrop.contractRoles,
    );
    this.royalties = new ContractRoyalty(this.contractWrapper, this.metadata);
    this.sales = new ContractPrimarySale(this.contractWrapper);
    this.analytics = new ContractAnalytics(this.contractWrapper);
    this.encoder = new ContractEncoder(this.contractWrapper);
    this.estimator = new GasCostEstimator(this.contractWrapper);
    this.events = new ContractEvents(this.contractWrapper);
    this.platformFees = new ContractPlatformFee(this.contractWrapper);
    this.interceptor = new ContractInterceptor(this.contractWrapper);
    this.revealer = new DelayedReveal(this, this.contractWrapper, this.storage);
    this.signature = new Erc721WithQuantitySignatureMinting(
      this.contractWrapper,
      this.roles,
      this.storage,
    );
    this.claimCondition = new DropSingleClaimConditions(
      this.contractWrapper,
      this.metadata,
      this.storage,
    );
  }

  /** ******************************
   * READ FUNCTIONS
   *******************************/

  /**
   * Get All Minted NFTs
   *
   * @remarks Get all the data associated with every NFT in this contract.
   *
   * By default, returns the first 100 NFTs, use queryParams to fetch more.
   *
   * @example
   * ```javascript
   * const nfts = await contract.getAll();
   * console.log(nfts);
   * ```
   * @param queryParams - optional filtering to only fetch a subset of results.
   * @returns The NFT metadata for all NFTs queried.
   */
  public async getAll(
    queryParams?: QueryAllParams,
  ): Promise<NFTMetadataOwner[]> {
    return this._query.all(queryParams);
  }

  /**
   * Get Owned NFTs
   *
   * @remarks Get all the data associated with the NFTs owned by a specific wallet.
   *
   * @example
   * ```javascript
   * // Address of the wallet to get the NFTs of
   * const address = "{{wallet_address}}";
   * const nfts = await contract.getOwned(address);
   * console.log(nfts);
   * ```
   * @param walletAddress - the wallet address to query, defaults to the connected wallet
   * @returns The NFT metadata for all NFTs in the contract.
   */
  public async getOwned(walletAddress?: string): Promise<NFTMetadataOwner[]> {
    return this._owned.all(walletAddress);
  }

  /**
   * {@inheritDoc Erc721Enumerable.tokendIds}
   */
  public async getOwnedTokenIds(walletAddress?: string): Promise<BigNumber[]> {
    return this._owned.tokenIds(walletAddress);
  }

  /**
   * Get the total count NFTs in this drop contract, both claimed and unclaimed
   */
  public async totalSupply() {
    const claimed = await this.totalClaimedSupply();
    const unclaimed = await this.totalUnclaimedSupply();
    return claimed.add(unclaimed);
  }

  /**
   * Get All Claimed NFTs
   *
   * @remarks Fetch all the NFTs (and their owners) that have been claimed in this Drop.
   *
   * * @example
   * ```javascript
   * const claimedNFTs = await contract.getAllClaimed();
   * const firstOwner = claimedNFTs[0].owner;
   * ```
   *
   * @param queryParams - optional filtering to only fetch a subset of results.
   * @returns The NFT metadata and their ownersfor all NFTs queried.
   */
  public async getAllClaimed(
    queryParams?: QueryAllParams,
  ): Promise<NFTMetadataOwner[]> {
    const start = BigNumber.from(queryParams?.start || 0).toNumber();
    const count = BigNumber.from(
      queryParams?.count || DEFAULT_QUERY_ALL_COUNT,
    ).toNumber();
    const maxId = Math.min(
      (await this.contractWrapper.readContract.nextTokenIdToMint()).toNumber(),
      start + count,
    );
    return await Promise.all(
      Array.from(Array(maxId).keys()).map((i) => this.get(i.toString())),
    );
  }

  /**
   * Get All Unclaimed NFTs
   *
   * @remarks Fetch all the NFTs that have been not been claimed yet in this Drop.
   *
   * * @example
   * ```javascript
   * const unclaimedNFTs = await contract.getAllUnclaimed();
   * const firstUnclaimedNFT = unclaimedNFTs[0].name;
   * ```
   *
   * @param queryParams - optional filtering to only fetch a subset of results.
   * @returns The NFT metadata for all NFTs queried.
   */
  public async getAllUnclaimed(
    queryParams?: QueryAllParams,
  ): Promise<NFTMetadata[]> {
    const start = BigNumber.from(queryParams?.start || 0).toNumber();
    const count = BigNumber.from(
      queryParams?.count || DEFAULT_QUERY_ALL_COUNT,
    ).toNumber();
    const firstTokenId = BigNumber.from(
      Math.max(
        (
          await this.contractWrapper.readContract.nextTokenIdToMint()
        ).toNumber(),
        start,
      ),
    );
    const maxId = BigNumber.from(
      Math.min(
        (
          await this.contractWrapper.readContract.nextTokenIdToMint()
        ).toNumber(),
        firstTokenId.toNumber() + count,
      ),
    );

    return await Promise.all(
      Array.from(Array(maxId.sub(firstTokenId).toNumber()).keys()).map((i) =>
        this.getTokenMetadata(firstTokenId.add(i).toString()),
      ),
    );
  }

  /**
   * Get the claimed supply
   *
   * @remarks Get the number of claimed NFTs in this Drop.
   *
   * * @example
   * ```javascript
   * const claimedNFTCount = await contract.totalClaimedSupply();
   * console.log(`NFTs claimed so far: ${claimedNFTCount}`);
   * ```
   * @returns the claimed supply
   */
  public async totalClaimedSupply(): Promise<BigNumber> {
    const claimCondition =
      await this.contractWrapper.readContract.claimCondition();

    return claimCondition.supplyClaimed;
  }

  /**
   * Get the unclaimed supply
   *
   * @remarks Get the number of unclaimed NFTs in this Drop.
   *
   * * @example
   * ```javascript
   * const unclaimedNFTCount = await contract.totalUnclaimedSupply();
   * console.log(`NFTs left to claim: ${unclaimedNFTCount}`);
   * ```
   * @returns the unclaimed supply
   */
  public async totalUnclaimedSupply(): Promise<BigNumber> {
    const maxSupply =
      await this.contractWrapper.readContract.nextTokenIdToMint();

    return maxSupply.sub(await this.totalClaimedSupply());
  }

  /**
   * Get whether users can transfer NFTs from this contract
   */
  public async isTransferRestricted(): Promise<boolean> {
    const anyoneCanTransfer = await this.contractWrapper.readContract.hasRole(
      getRoleHash("transfer"),
      constants.AddressZero,
    );
    return !anyoneCanTransfer;
  }

  /** ******************************
   * WRITE FUNCTIONS
   *******************************/

  /**
   * Create a batch of unique NFTs to be claimed in the future
   *
   * @remarks Create batch allows you to create a batch of many unique NFTs in one transaction.
   *
   * @example
   * ```javascript
   * // Custom metadata of the NFTs to create
   * const metadatas = [{
   *   name: "Cool NFT",
   *   description: "This is a cool NFT",
   *   image: fs.readFileSync("path/to/image.png"), // This can be an image url or file
   * }, {
   *   name: "Cool NFT",
   *   description: "This is a cool NFT",
   *   image: fs.readFileSync("path/to/image.png"),
   * }];
   *
   * const results = await contract.createBatch(metadatas); // uploads and creates the NFTs on chain
   * const firstTokenId = results[0].id; // token id of the first created NFT
   * const firstNFT = await results[0].data(); // (optional) fetch details of the first created NFT
   * ```
   *
   * @param metadatas - The metadata to include in the batch.
   */
  public async createBatch(
    metadatas: NFTMetadataInput[],
  ): Promise<TransactionResultWithId<NFTMetadata>[]> {
    const startFileNumber =
      await this.contractWrapper.readContract.nextTokenIdToMint();
    const batch = await this.storage.uploadMetadataBatch(
      metadatas.map((m) => CommonNFTInput.parse(m)),
      startFileNumber.toNumber(),
      this.contractWrapper.readContract.address,
      await this.contractWrapper.getSigner()?.getAddress(),
    );
    const baseUri = batch.baseUri;
    const receipt = await this.contractWrapper.sendTransaction("lazyMint", [
      batch.uris.length,
      baseUri.endsWith("/") ? baseUri : `${baseUri}/`,
      ethers.utils.toUtf8Bytes(""),
    ]);
    const event = this.contractWrapper.parseLogs<TokensLazyMintedEvent>(
      "TokensLazyMinted",
      receipt?.logs,
    );
    const startingIndex = event[0].args.startTokenId;
    const endingIndex = event[0].args.endTokenId;
    const results = [];
    for (let id = startingIndex; id.lte(endingIndex); id = id.add(1)) {
      results.push({
        id,
        receipt,
        data: () => this.getTokenMetadata(id),
      });
    }
    return results;
  }

  /**
   * Claim unique NFTs to a specific Wallet
   *
   * @remarks Let the specified wallet claim NFTs.
   *
   * @example
   * ```javascript
   * const address = "{{wallet_address}}"; // address of the wallet you want to claim the NFTs
   * const quantity = 1; // how many unique NFTs you want to claim
   *
   * const tx = await contract.claimTo(address, quantity);
   * const receipt = tx.receipt; // the transaction receipt
   * const claimedTokenId = tx.id; // the id of the NFT claimed
   * const claimedNFT = await tx.data(); // (optional) get the claimed NFT metadata
   * ```
   *
   * @param destinationAddress - Address you want to send the token to
   * @param quantity - Quantity of the tokens you want to claim
   * @param proofs - Array of proofs
   *
   * @returns - an array of results containing the id of the token claimed, the transaction receipt and a promise to optionally fetch the nft metadata
   */
  public async claimTo(
    destinationAddress: string,
    quantity: BigNumberish,
    proofs: BytesLike[] = [utils.hexZeroPad([0], 32)],
  ): Promise<TransactionResultWithId<NFTMetadataOwner>[]> {
    const claimVerification = await this.prepareClaim(quantity, proofs);
    const receipt = await this.contractWrapper.sendTransaction(
      "claim",
      [
        destinationAddress,
        quantity,
        claimVerification.currencyAddress,
        claimVerification.price,
        {
          proof: claimVerification.proofs,
          maxQuantityInAllowlist: claimVerification.maxQuantityPerTransaction,
        },
        ethers.utils.toUtf8Bytes(""),
      ],
      claimVerification.overrides,
    );
    const event = this.contractWrapper.parseLogs<TokensClaimedEvent>(
      "TokensClaimed",
      receipt?.logs,
    );
    const startingIndex: BigNumber = event[0].args.startTokenId;
    const endingIndex = startingIndex.add(quantity);
    const results = [];
    for (let id = startingIndex; id.lt(endingIndex); id = id.add(1)) {
      results.push({
        id,
        receipt,
        data: () => this.get(id),
      });
    }
    return results;
  }

  /**
   * Claim NFTs to the connected wallet.
   *
   * @remarks See {@link NFTDrop.claimTo}
   *
   * @returns - an array of results containing the id of the token claimed, the transaction receipt and a promise to optionally fetch the nft metadata
   */
  public async claim(
    quantity: BigNumberish,
    proofs: BytesLike[] = [utils.hexZeroPad([0], 32)],
  ): Promise<TransactionResultWithId<NFTMetadataOwner>[]> {
    return this.claimTo(
      await this.contractWrapper.getSignerAddress(),
      quantity,
      proofs,
    );
  }

  /**
   * Burn a single NFT
   * @param tokenId - the token Id to burn
   */
  public async burn(tokenId: BigNumberish): Promise<TransactionResult> {
    return {
      receipt: await this.contractWrapper.sendTransaction("burn", [tokenId]),
    };
  }

  /** ******************************
   * PRIVATE FUNCTIONS
   *******************************/

  /**
   * Returns proofs and the overrides required for the transaction.
   *
   * @returns - `overrides` and `proofs` as an object.
   */
  private async prepareClaim(
    quantity: BigNumberish,
    proofs: BytesLike[] = [utils.hexZeroPad([0], 32)],
  ): Promise<ClaimVerification> {
    return prepareClaim(
      quantity,
      await this.claimCondition.get(),
      (await this.metadata.get()).merkle,
      0,
      this.contractWrapper,
      this.storage,
      proofs,
    );
  }
}
