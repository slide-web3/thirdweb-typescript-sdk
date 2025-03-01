import { UpdateableNetwork } from "../core/interfaces/contract";
import { IERC20, Split as SplitContract } from "contracts";
import { ContractWrapper } from "../core/classes/contract-wrapper";
import { ContractInterceptor } from "../core/classes/contract-interceptor";
import { IStorage } from "../core/interfaces/IStorage";
import { NetworkOrSignerOrProvider, TransactionResult } from "../core/types";
import { ContractMetadata } from "../core/classes/contract-metadata";
import { ContractEncoder } from "../core/classes/contract-encoder";
import { SDKOptions } from "../schema/sdk-options";
import { CurrencyValue } from "../types/currency";
import { fetchCurrencyValue } from "../common/currency";
import { BigNumber, Contract } from "ethers";
import { SplitRecipient } from "../types/SplitRecipient";
import { SplitsContractSchema } from "../schema/contracts/splits";
import { GasCostEstimator } from "../core/classes/gas-cost-estimator";
import { ContractEvents } from "../core/classes/contract-events";
import ERC20Abi from "../../abis/IERC20.json";
import { ContractAnalytics } from "../core/classes/contract-analytics";

/**
 * Create custom royalty splits to distribute funds.
 *
 * @example
 *
 * ```javascript
 * import { ThirdwebSDK } from "@thirdweb-dev/sdk";
 *
 * const sdk = new ThirdwebSDK("rinkeby");
 * const contract = sdk.getSplit("{{contract_address}}");
 * ```
 *
 * @public
 */
export class Split implements UpdateableNetwork {
  static contractType = "split" as const;
  static contractAbi = require("../../abis/Split.json");
  /**
   * @internal
   */
  static schema = SplitsContractSchema;

  private contractWrapper: ContractWrapper<SplitContract>;
  private storage: IStorage;

  public metadata: ContractMetadata<SplitContract, typeof Split.schema>;
  public encoder: ContractEncoder<SplitContract>;
  public estimator: GasCostEstimator<SplitContract>;
  public events: ContractEvents<SplitContract>;
  /**
   * @internal
   */
  public interceptor: ContractInterceptor<SplitContract>;
  /**
   * @internal
   */
  public analytics: ContractAnalytics<SplitContract>;

  constructor(
    network: NetworkOrSignerOrProvider,
    address: string,
    storage: IStorage,
    options: SDKOptions = {},
    contractWrapper = new ContractWrapper<SplitContract>(
      network,
      address,
      Split.contractAbi,
      options,
    ),
  ) {
    this.contractWrapper = contractWrapper;
    this.storage = storage;
    this.metadata = new ContractMetadata(
      this.contractWrapper,
      Split.schema,
      this.storage,
    );
    this.analytics = new ContractAnalytics(this.contractWrapper);
    this.encoder = new ContractEncoder(this.contractWrapper);
    this.estimator = new GasCostEstimator(this.contractWrapper);
    this.events = new ContractEvents(this.contractWrapper);
    this.interceptor = new ContractInterceptor(this.contractWrapper);
  }

  onNetworkUpdated(network: NetworkOrSignerOrProvider) {
    this.contractWrapper.updateSignerOrProvider(network);
  }

  getAddress(): string {
    return this.contractWrapper.readContract.address;
  }

  /** ******************************
   * READ FUNCTIONS
   *******************************/

  /**
   * Get Recipients of this splits contract
   *
   * @remarks Get the data about the shares of every split recipient on the contract
   *
   * @example
   * ```javascript
   * const recipients = await contract.getAllRecipients();
   * console.log(recipients);
   * ```
   */
  public async getAllRecipients(): Promise<SplitRecipient[]> {
    const recipients: SplitRecipient[] = [];
    let index = BigNumber.from(0);
    const totalRecipients =
      await this.contractWrapper.readContract.payeeCount();
    while (index.lt(totalRecipients)) {
      try {
        const recipientAddress = await this.contractWrapper.readContract.payee(
          index,
        );
        recipients.push(
          await this.getRecipientSplitPercentage(recipientAddress),
        );
        index = index.add(1);
      } catch (err: any) {
        // The only way we know how to detect that we've found all recipients
        // is if we get an error when trying to get the next recipient.
        if (
          "method" in err &&
          (err["method"] as string).toLowerCase().includes("payee(uint256)")
        ) {
          break;
        } else {
          throw err;
        }
      }
    }
    return recipients;
  }

  /**
   * Returns all the recipients and their balances in the native currency.
   *
   * @returns A map of recipient addresses to their balances in the native currency.
   */
  public async balanceOfAllRecipients() {
    const recipients = await this.getAllRecipients();
    const balances: { [key: string]: BigNumber } = {};
    for (const recipient of recipients) {
      balances[recipient.address] = await this.balanceOf(recipient.address);
    }
    return balances;
  }

  /**
   * Returns all the recipients and their balances in a non-native currency.
   *
   * @param tokenAddress - The address of the currency to check the balances in.
   * @returns A map of recipient addresses to their balances in the specified currency.
   */
  public async balanceOfTokenAllRecipients(tokenAddress: string) {
    const recipients = await this.getAllRecipients();
    const balances: { [key: string]: CurrencyValue } = {};
    for (const recipient of recipients) {
      balances[recipient.address] = await this.balanceOfToken(
        recipient.address,
        tokenAddress,
      );
    }
    return balances;
  }

  /**
   * Get Funds owed to a particular wallet
   *
   * @remarks Get the amount of funds in the native currency held by the contract that is owed to a specific recipient.
   *
   * @example
   * ```javascript
   * // The address to check the funds of
   * const address = "{{wallet_address}}";
   * const funds = await contract.balanceOf(address);
   * console.log(funds);
   * ```
   */
  public async balanceOf(address: string): Promise<BigNumber> {
    const walletBalance =
      await this.contractWrapper.readContract.provider.getBalance(
        this.getAddress(),
      );
    const totalReleased = await this.contractWrapper.readContract[
      "totalReleased()"
    ]();
    const totalReceived = walletBalance.add(totalReleased);

    return this._pendingPayment(
      address,
      totalReceived,
      await this.contractWrapper.readContract["released(address)"](address),
    );
  }

  /**
   * Get non-native Token Funds owed to a particular wallet
   *
   * @remarks Get the amount of funds in the non-native tokens held by the contract that is owed to a specific recipient.
   *
   * @example
   * ```javascript
   * // The address to check the funds of
   * const address = "{{wallet_address}}";
   * // The address of the currency to check the contracts funds of
   * const tokenAddress = "0x..."
   * const funds = await contract.balanceOfToken(address, tokenAddress);
   * console.log(funds);
   * ```
   */
  public async balanceOfToken(
    walletAddress: string,
    tokenAddress: string,
  ): Promise<CurrencyValue> {
    const erc20 = new Contract(
      tokenAddress,
      ERC20Abi,
      this.contractWrapper.getProvider(),
    ) as IERC20;
    const walletBalance = await erc20.balanceOf(this.getAddress());
    const totalReleased = await this.contractWrapper.readContract[
      "totalReleased(address)"
    ](tokenAddress);
    const totalReceived = walletBalance.add(totalReleased);
    const value = await this._pendingPayment(
      walletAddress,
      totalReceived,
      await this.contractWrapper.readContract["released(address,address)"](
        tokenAddress,
        walletAddress,
      ),
    );
    return await fetchCurrencyValue(
      this.contractWrapper.getProvider(),
      tokenAddress,
      value,
    );
  }

  /**
   * Get the % of funds owed to a given address
   * @param address - the address to check percentage of
   */
  public async getRecipientSplitPercentage(
    address: string,
  ): Promise<SplitRecipient> {
    const [totalShares, walletsShares] = await Promise.all([
      this.contractWrapper.readContract.totalShares(),
      this.contractWrapper.readContract.shares(address),
    ]);
    // We convert to basis points to avoid floating point loss of precision
    return {
      address,
      splitPercentage:
        walletsShares.mul(BigNumber.from(1e7)).div(totalShares).toNumber() /
        1e5,
    };
  }

  /** ******************************
   * WRITE FUNCTIONS
   *******************************/

  /**
   * Withdraw Funds
   * @remarks Triggers a transfer to account of the amount of native currency they are owed.
   *
   * @example
   * ```javascript
   * // the wallet address that wants to withdraw their funds
   * const walletAddress = "{{wallet_address}}"
   * await contract.withdraw(walletAddress);
   * ```
   *
   * @param walletAddress - The address to distributes the amount to
   */
  public async withdraw(walletAddress: string): Promise<TransactionResult> {
    return {
      receipt: await this.contractWrapper.sendTransaction("release(address)", [
        walletAddress,
      ]),
    };
  }

  /**
   * Triggers a transfer to account of the amount of a given currency they are owed.
   *
   * @param walletAddress - The address to distributes the amount to
   * @param tokenAddress - The address of the currency contract to distribute funds
   */
  public async withdrawToken(
    walletAddress: string,
    tokenAddress: string,
  ): Promise<TransactionResult> {
    return {
      receipt: await this.contractWrapper.sendTransaction(
        "release(address,address)",
        [tokenAddress, walletAddress],
      ),
    };
  }

  /**
   * Distribute Funds
   *
   * @remarks Distribute funds held by the contract in the native currency to all recipients.
   *
   * @example
   * ```javascript
   * await contract.distribute();
   * ```
   */
  public async distribute(): Promise<TransactionResult> {
    return {
      receipt: await this.contractWrapper.sendTransaction("distribute()", []),
    };
  }

  /**
   * Distribute Funds
   *
   * @remarks Distribute funds held by the contract in the native currency to all recipients.
   *
   * @example
   * ```javascript
   * // The address of the currency to distribute funds
   * const tokenAddress = "0x..."
   * await contract.distributeToken(tokenAddress);
   * ```
   *
   * @param tokenAddress - The address of the currency contract to distribute funds
   */
  public async distributeToken(
    tokenAddress: string,
  ): Promise<TransactionResult> {
    return {
      receipt: await this.contractWrapper.sendTransaction(
        "distribute(address)",
        [tokenAddress],
      ),
    };
  }

  /** ******************************
   * PRIVATE FUNCTIONS
   *******************************/

  private async _pendingPayment(
    address: string,
    totalReceived: BigNumber,
    alreadyReleased: BigNumber,
  ): Promise<BigNumber> {
    const addressReceived = totalReceived.mul(
      await this.contractWrapper.readContract.shares(address),
    );
    const totalRoyaltyAvailable = addressReceived.div(
      await this.contractWrapper.readContract.totalShares(),
    );
    return totalRoyaltyAvailable.sub(alreadyReleased);
  }
}
