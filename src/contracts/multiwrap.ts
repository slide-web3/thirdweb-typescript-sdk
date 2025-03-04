import {
  NetworkOrSignerOrProvider,
  TransactionResult,
  TransactionResultWithId,
} from "../core/types";
import { Erc721 } from "../core/classes/erc-721";
import { ContractMetadata } from "../core/classes/contract-metadata";
import { ContractRoles } from "../core/classes/contract-roles";
import { ContractRoyalty } from "../core/classes/contract-royalty";
import { ContractEvents } from "../core/classes/contract-events";
import { ContractEncoder } from "../core/classes/contract-encoder";
import { GasCostEstimator } from "../core/classes/gas-cost-estimator";
import { NFTMetadataOrUri, NFTMetadataOwner, SDKOptions } from "../schema";
import { Multiwrap as MultiwrapContract } from "contracts";
import { ContractWrapper } from "../core/classes/contract-wrapper";
import { uploadOrExtractURI } from "../common/nft";
import {
  ERC1155Wrappable,
  ERC20Wrappable,
  ERC721Wrappable,
  TokensToWrap,
  WrappedTokens,
} from "../types/multiwrap";
import {
  fetchCurrencyMetadata,
  hasERC20Allowance,
  normalizePriceValue,
} from "../common/currency";
import { ITokenBundle, TokensWrappedEvent } from "contracts/Multiwrap";
import { MultiwrapContractSchema } from "../schema/contracts/multiwrap";
import { BigNumberish, ethers } from "ethers";
import TokenStruct = ITokenBundle.TokenStruct;
import { QueryAllParams } from "../types";
import { isTokenApprovedForTransfer } from "../common/marketplace";
import { Erc721Supply } from "../core/classes/erc-721-supply";
import { IStorage } from "../core/interfaces/IStorage";

/**
 * Multiwrap lets you wrap any number of ERC20, ERC721 and ERC1155 tokens you own into a single wrapped token bundle.
 *
 * @example
 *
 * ```javascript
 * import { ThirdwebSDK } from "@thirdweb-dev/sdk";
 *
 * const sdk = new ThirdwebSDK("rinkeby");
 * const contract = sdk.getMultiwrap("{{contract_address}}");
 * ```
 *
 * @beta
 */
export class Multiwrap extends Erc721<MultiwrapContract> {
  static contractType = "multiwrap" as const;
  static contractRoles = ["transfer", "minter", "unwrap", "asset"] as const;
  static contractAbi = require("../../abis/Multiwrap.json");

  /**
   * @internal
   */
  static schema = MultiwrapContractSchema;

  public encoder: ContractEncoder<MultiwrapContract>;
  public estimator: GasCostEstimator<MultiwrapContract>;
  public metadata: ContractMetadata<MultiwrapContract, typeof Multiwrap.schema>;
  public events: ContractEvents<MultiwrapContract>;
  public roles: ContractRoles<
    MultiwrapContract,
    typeof Multiwrap.contractRoles[number]
  >;

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
  public royalties: ContractRoyalty<MultiwrapContract, typeof Multiwrap.schema>;

  private _query = this.query as Erc721Supply;

  constructor(
    network: NetworkOrSignerOrProvider,
    address: string,
    storage: IStorage,
    options: SDKOptions = {},
    contractWrapper = new ContractWrapper<MultiwrapContract>(
      network,
      address,
      Multiwrap.contractAbi,
      options,
    ),
  ) {
    super(contractWrapper, storage, options);
    this.metadata = new ContractMetadata(
      this.contractWrapper,
      Multiwrap.schema,
      this.storage,
    );

    this.roles = new ContractRoles(
      this.contractWrapper,
      Multiwrap.contractRoles,
    );
    this.encoder = new ContractEncoder(this.contractWrapper);
    this.estimator = new GasCostEstimator(this.contractWrapper);
    this.events = new ContractEvents(this.contractWrapper);
    this.royalties = new ContractRoyalty(this.contractWrapper, this.metadata);
  }

  /** ******************************
   * READ FUNCTIONS
   *******************************/

  /**
   * Get All Wrapped Token Bundles
   *
   * @remarks Get all the data associated with every token bundle in this contract.
   *
   * By default, returns the first 100 NFTs, use queryParams to fetch more.
   *
   * @example
   * ```javascript
   * const wrappedBundles = await contract.getAll();
   * console.log(wrappedBundles);
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
   * Get the contents of a wrapped token bundle
   * @example
   * ```javascript
   * const contents = await contract.getWrappedContents(wrappedTokenId);
   * console.log(contents.erc20Tokens);
   * console.log(contents.erc721Tokens);
   * console.log(contents.erc1155Tokens);
   * ```
   * @param wrappedTokenId - the id of the wrapped token bundle
   */
  public async getWrappedContents(
    wrappedTokenId: BigNumberish,
  ): Promise<WrappedTokens> {
    const wrappedTokens =
      await this.contractWrapper.readContract.getWrappedContents(
        wrappedTokenId,
      );

    const erc20Tokens: ERC20Wrappable[] = [];
    const erc721Tokens: ERC721Wrappable[] = [];
    const erc1155Tokens: ERC1155Wrappable[] = [];

    for (const token of wrappedTokens) {
      switch (token.tokenType) {
        case 0: {
          const tokenMetadata = await fetchCurrencyMetadata(
            this.contractWrapper.getProvider(),
            token.assetContract,
          );
          erc20Tokens.push({
            contractAddress: token.assetContract,
            quantity: ethers.utils.formatUnits(
              token.totalAmount,
              tokenMetadata.decimals,
            ),
          });
          break;
        }
        case 1: {
          erc721Tokens.push({
            contractAddress: token.assetContract,
            tokenId: token.tokenId,
          });
          break;
        }
        case 2: {
          erc1155Tokens.push({
            contractAddress: token.assetContract,
            tokenId: token.tokenId,
            quantity: token.totalAmount.toString(),
          });
          break;
        }
      }
    }
    return {
      erc20Tokens,
      erc721Tokens,
      erc1155Tokens,
    };
  }

  /** ******************************
   * WRITE FUNCTIONS
   *******************************/

  /**
   * Wrap any number of ERC20/ERC721/ERC1155 tokens into a single wrapped token
   * @example
   * ```javascript
   * const tx = await contract.wrap({
   *   erc20Tokens: [{
   *     contractAddress: "0x...",
   *     quantity: "0.8"
   *   }],
   *   erc721Tokens: [{
   *     contractAddress: "0x...",
   *     tokenId: "0"
   *   }],
   *   erc1155Tokens: [{
   *     contractAddress: "0x...",
   *     tokenId: "1",
   *     quantity: "2"
   *   }]
   * }, {
   *     name: "Wrapped bundle",
   *     description: "This is a wrapped bundle of tokens and NFTs",
   *     image: "ipfs://...",
   * });
   * const receipt = tx.receipt(); // the transaction receipt
   * const wrappedTokenId = tx.id; // the id of the wrapped token bundle
   * ```
   * @param contents - the contents to wrap
   * @param wrappedTokenMetadata - metadata to represent the wrapped token bundle
   * @param recipientAddress - Optional. The address to send the wrapped token bundle to
   */
  public async wrap(
    contents: TokensToWrap,
    wrappedTokenMetadata: NFTMetadataOrUri,
    recipientAddress?: string,
  ): Promise<TransactionResultWithId<NFTMetadataOwner>> {
    const uri = await uploadOrExtractURI(wrappedTokenMetadata, this.storage);

    const recipient = recipientAddress
      ? recipientAddress
      : await this.contractWrapper.getSignerAddress();

    const tokens = await this.toTokenStructList(contents);
    const receipt = await this.contractWrapper.sendTransaction("wrap", [
      tokens,
      uri,
      recipient,
    ]);

    const event = this.contractWrapper.parseLogs<TokensWrappedEvent>(
      "TokensWrapped",
      receipt?.logs,
    );
    if (event.length === 0) {
      throw new Error("TokensWrapped event not found");
    }
    const tokenId = event[0].args.tokenIdOfWrappedToken;
    return {
      id: tokenId,
      receipt,
      data: () => this.get(tokenId),
    };
  }

  /**
   * Unwrap a wrapped token bundle, and retrieve its contents
   * @example
   * ```javascript
   * await contract.unwrap(wrappedTokenId);
   * ```
   * @param wrappedTokenId - the id of the wrapped token bundle
   * @param recipientAddress - Optional. The address to send the unwrapped tokens to
   */
  public async unwrap(
    wrappedTokenId: BigNumberish,
    recipientAddress?: string,
  ): Promise<TransactionResult> {
    const recipient = recipientAddress
      ? recipientAddress
      : await this.contractWrapper.getSignerAddress();
    return {
      receipt: await this.contractWrapper.sendTransaction("unwrap", [
        wrappedTokenId,
        recipient,
      ]),
    };
  }

  /** ******************************
   * PRIVATE FUNCTIONS
   *******************************/

  private async toTokenStructList(contents: TokensToWrap) {
    const tokens: TokenStruct[] = [];

    const provider = this.contractWrapper.getProvider();
    const owner = await this.contractWrapper.getSignerAddress();

    if (contents.erc20Tokens) {
      for (const erc20 of contents.erc20Tokens) {
        const normalizedQuantity = await normalizePriceValue(
          provider,
          erc20.quantity,
          erc20.contractAddress,
        );
        const hasAllowance = await hasERC20Allowance(
          this.contractWrapper,
          erc20.contractAddress,
          normalizedQuantity,
        );
        if (!hasAllowance) {
          throw new Error(
            `ERC20 token with contract address "${
              erc20.contractAddress
            }" does not have enough allowance to transfer.\n\nYou can set allowance to the multiwrap contract to transfer these tokens by running:\n\nawait sdk.getToken("${
              erc20.contractAddress
            }").setAllowance("${this.getAddress()}", ${erc20.quantity});\n\n`,
          );
        }
        tokens.push({
          assetContract: erc20.contractAddress,
          totalAmount: normalizedQuantity,
          tokenId: 0,
          tokenType: 0,
        });
      }
    }

    if (contents.erc721Tokens) {
      for (const erc721 of contents.erc721Tokens) {
        const isApproved = await isTokenApprovedForTransfer(
          this.contractWrapper.getProvider(),
          this.getAddress(),
          erc721.contractAddress,
          erc721.tokenId,
          owner,
        );

        if (!isApproved) {
          throw new Error(
            `ERC721 token "${erc721.tokenId}" with contract address "${
              erc721.contractAddress
            }" is not approved for transfer.\n\nYou can give approval the multiwrap contract to transfer this token by running:\n\nawait sdk.getNFTCollection("${
              erc721.contractAddress
            }").setApprovalForToken("${this.getAddress()}", ${
              erc721.tokenId
            });\n\n`,
          );
        }

        tokens.push({
          assetContract: erc721.contractAddress,
          totalAmount: 0,
          tokenId: erc721.tokenId,
          tokenType: 1,
        });
      }
    }

    if (contents.erc1155Tokens) {
      for (const erc1155 of contents.erc1155Tokens) {
        const isApproved = await isTokenApprovedForTransfer(
          this.contractWrapper.getProvider(),
          this.getAddress(),
          erc1155.contractAddress,
          erc1155.tokenId,
          owner,
        );

        if (!isApproved) {
          throw new Error(
            `ERC1155 token "${erc1155.tokenId}" with contract address "${
              erc1155.contractAddress
            }" is not approved for transfer.\n\nYou can give approval the multiwrap contract to transfer this token by running:\n\nawait sdk.getEdition("${
              erc1155.contractAddress
            }").setApprovalForAll("${this.getAddress()}", true);\n\n`,
          );
        }
        tokens.push({
          assetContract: erc1155.contractAddress,
          totalAmount: erc1155.quantity,
          tokenId: erc1155.tokenId,
          tokenType: 2,
        });
      }
    }
    return tokens;
  }
}
