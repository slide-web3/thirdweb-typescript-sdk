import { TWFactory, TWFactory__factory } from "contracts";
import { BigNumber, Contract, ethers, constants } from "ethers";
import { z } from "zod";
import { CONTRACTS_MAP, REMOTE_CONTRACT_NAME } from "../../contracts/maps";
import { Edition } from "../../contracts/edition";
import { EditionDrop } from "../../contracts/edition-drop";
import { NFTCollection } from "../../contracts/nft-collection";
import { NFTDrop } from "../../contracts/nft-drop";
import { Marketplace } from "../../contracts/marketplace";
import { SignatureDrop } from "../../contracts/signature-drop";
import { Pack } from "../../contracts/pack";
import { Split } from "../../contracts/split";
import { Vote } from "../../contracts/vote";
import { Token } from "../../contracts/token";
import { SDKOptions } from "../../schema/sdk-options";
import { IStorage } from "../interfaces/IStorage";
import { NetworkOrSignerOrProvider, ValidContractClass } from "../types";
import { ContractWrapper } from "./contract-wrapper";

import { ChainlinkVrf } from "../../constants/chainlink";
import {
  CONTRACT_ADDRESSES,
  getContractAddressByChainId,
  OZ_DEFENDER_FORWARDER_ADDRESS,
  SUPPORTED_CHAIN_IDS,
} from "../../constants";
import { TokenDrop } from "../../contracts/token-drop";
import { ProxyDeployedEvent } from "contracts/TWFactory";
import { Multiwrap } from "../../contracts/multiwrap";
import { AddressZero } from "@ethersproject/constants";

/**
 * @internal
 */
export class ContractFactory extends ContractWrapper<TWFactory> {
  private storage: IStorage;

  constructor(
    factoryAddr: string,
    network: NetworkOrSignerOrProvider,
    storage: IStorage,
    options?: SDKOptions,
  ) {
    super(network, factoryAddr, TWFactory__factory.abi, options);
    this.storage = storage;
  }

  public async deploy<TContract extends ValidContractClass>(
    contractType: TContract["contractType"],
    contractMetadata: z.input<TContract["schema"]["deploy"]>,
  ): Promise<string> {
    const contract = CONTRACTS_MAP[contractType];
    const metadata = contract.schema.deploy.parse(contractMetadata);

    // TODO: is there any special pre-processing we need to do before uploading?
    const contractURI = await this.storage.uploadMetadata(
      metadata,
      this.readContract.address,
      await this.getSigner()?.getAddress(),
    );

    const encodedFunc = Contract.getInterface(
      contract.contractAbi,
    ).encodeFunctionData(
      "initialize",
      await this.getDeployArguments(contractType, metadata, contractURI),
    );

    const contractName = REMOTE_CONTRACT_NAME[contractType];
    const encodedType = ethers.utils.formatBytes32String(contractName);
    let receipt;
    try {
      receipt = await this.sendTransaction("deployProxy", [
        encodedType,
        encodedFunc,
      ]);
    } catch (e) {
      // deploy might fail due to salt already used, fallback to deterministic deploy
      const blockNumber = await this.getProvider().getBlockNumber();
      receipt = await this.sendTransaction("deployProxyDeterministic", [
        encodedType,
        encodedFunc,
        ethers.utils.formatBytes32String(blockNumber.toString()),
      ]);
    }

    const events = this.parseLogs<ProxyDeployedEvent>(
      "ProxyDeployed",
      receipt.logs,
    );
    if (events.length < 1) {
      throw new Error("No ProxyDeployed event found");
    }

    return events[0].args.proxy;
  }

  private async getDeployArguments<TContract extends ValidContractClass>(
    contractType: TContract["contractType"],
    metadata: z.input<TContract["schema"]["deploy"]>,
    contractURI: string,
  ): Promise<any[]> {
    let trustedForwarders = await this.getDefaultTrustedForwarders();
    // override default forwarders if custom ones are passed in
    if (metadata.trusted_forwarders && metadata.trusted_forwarders.length > 0) {
      trustedForwarders = metadata.trusted_forwarders;
    }
    switch (contractType) {
      case NFTDrop.contractType:
      case NFTCollection.contractType:
        const erc721metadata = NFTDrop.schema.deploy.parse(metadata);
        return [
          await this.getSignerAddress(),
          erc721metadata.name,
          erc721metadata.symbol,
          contractURI,
          trustedForwarders,
          erc721metadata.primary_sale_recipient,
          erc721metadata.fee_recipient,
          erc721metadata.seller_fee_basis_points,
          erc721metadata.platform_fee_basis_points,
          erc721metadata.platform_fee_recipient,
        ];
      case SignatureDrop.contractType:
        const signatureDropmetadata =
          SignatureDrop.schema.deploy.parse(metadata);
        const chainId = await this.getChainID();
        const signMintAddress = getContractAddressByChainId(chainId, "sigMint");
        if (signMintAddress === AddressZero) {
          throw new Error("SignatureDrop contract not deployable yet");
        }
        return [
          await this.getSignerAddress(),
          signatureDropmetadata.name,
          signatureDropmetadata.symbol,
          contractURI,
          trustedForwarders,
          signatureDropmetadata.primary_sale_recipient,
          signatureDropmetadata.fee_recipient,
          signatureDropmetadata.seller_fee_basis_points,
          signatureDropmetadata.platform_fee_basis_points,
          signatureDropmetadata.platform_fee_recipient,
        ];
      case Multiwrap.contractType:
        const multiwrapMetadata = Multiwrap.schema.deploy.parse(metadata);
        return [
          await this.getSignerAddress(),
          multiwrapMetadata.name,
          multiwrapMetadata.symbol,
          contractURI,
          trustedForwarders,
          multiwrapMetadata.fee_recipient,
          multiwrapMetadata.seller_fee_basis_points,
        ];
      case EditionDrop.contractType:
      case Edition.contractType:
        const erc1155metadata = EditionDrop.schema.deploy.parse(metadata);
        return [
          await this.getSignerAddress(),
          erc1155metadata.name,
          erc1155metadata.symbol,
          contractURI,
          trustedForwarders,
          erc1155metadata.primary_sale_recipient,
          erc1155metadata.fee_recipient,
          erc1155metadata.seller_fee_basis_points,
          erc1155metadata.platform_fee_basis_points,
          erc1155metadata.platform_fee_recipient,
        ];
      case TokenDrop.contractType:
      case Token.contractType:
        const erc20metadata = Token.schema.deploy.parse(metadata);
        return [
          await this.getSignerAddress(),
          erc20metadata.name,
          erc20metadata.symbol,
          contractURI,
          trustedForwarders,
          erc20metadata.primary_sale_recipient,
          erc20metadata.platform_fee_recipient,
          erc20metadata.platform_fee_basis_points,
        ];
      case Vote.contractType:
        const voteMetadata = Vote.schema.deploy.parse(metadata);
        return [
          voteMetadata.name,
          contractURI,
          trustedForwarders,
          voteMetadata.voting_token_address,
          voteMetadata.voting_delay_in_blocks,
          voteMetadata.voting_period_in_blocks,
          BigNumber.from(voteMetadata.proposal_token_threshold),
          voteMetadata.voting_quorum_fraction,
        ];
      case Split.contractType:
        const splitsMetadata = Split.schema.deploy.parse(metadata);
        return [
          await this.getSignerAddress(),
          contractURI,
          trustedForwarders,
          splitsMetadata.recipients.map((s) => s.address),
          splitsMetadata.recipients.map((s) => BigNumber.from(s.sharesBps)),
        ];
      case Marketplace.contractType:
        const marketplaceMetadata = Marketplace.schema.deploy.parse(metadata);
        return [
          await this.getSignerAddress(),
          contractURI,
          trustedForwarders,
          marketplaceMetadata.platform_fee_recipient,
          marketplaceMetadata.platform_fee_basis_points,
        ];
      case Pack.contractType:
        const packsMetadata = Pack.schema.deploy.parse(metadata);
        const vrf = ChainlinkVrf[await this.getChainID()];
        return [
          await this.getSignerAddress(),
          packsMetadata.name,
          packsMetadata.symbol,
          contractURI,
          trustedForwarders,
          packsMetadata.fee_recipient,
          packsMetadata.seller_fee_basis_points,
          vrf.fees,
          vrf.keyHash,
        ];
      default:
        return [];
    }
  }

  private async getDefaultTrustedForwarders(): Promise<string[]> {
    const chainId = await this.getChainID();
    const chainEnum = SUPPORTED_CHAIN_IDS.find((c) => c === chainId);
    const biconomyForwarder = chainEnum
      ? CONTRACT_ADDRESSES[chainEnum].biconomyForwarder
      : constants.AddressZero;
    return biconomyForwarder !== constants.AddressZero
      ? [OZ_DEFENDER_FORWARDER_ADDRESS, biconomyForwarder]
      : [OZ_DEFENDER_FORWARDER_ADDRESS];
  }
}
