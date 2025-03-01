import {
  BigNumber,
  BigNumberish,
  BytesLike,
  ethers,
  constants,
  providers,
  utils,
} from "ethers";
import {
  SnapshotInputSchema,
  SnapshotSchema,
} from "../schema/contracts/common/snapshots";
import {
  approveErc20Allowance,
  fetchCurrencyValue,
  isNativeToken,
  normalizePriceValue,
} from "./currency";
import {
  ClaimCondition,
  ClaimConditionInput,
  ClaimVerification,
  FilledConditionInput,
  SnapshotInfo,
} from "../types";
import { ContractWrapper } from "../core/classes/contract-wrapper";
import { IStorage } from "../core";
import {
  ClaimConditionInputArray,
  ClaimConditionInputSchema,
  ClaimConditionOutputSchema,
} from "../schema/contracts/common/claim-conditions";
import { createSnapshot } from "./snapshots";
import { NATIVE_TOKEN_ADDRESS } from "../constants";
import { IDropClaimCondition } from "contracts/DropERC20";
/**
 * Returns proofs and the overrides required for the transaction.
 * @internal
 * @returns - `overrides` and `proofs` as an object.
 */
export async function prepareClaim(
  quantity: BigNumberish,
  activeClaimCondition: ClaimCondition,
  merkleMetadata: Record<string, string>,
  tokenDecimals: number,
  contractWrapper: ContractWrapper<any>,
  storage: IStorage,
  proofs: BytesLike[] = [utils.hexZeroPad([0], 32)],
): Promise<ClaimVerification> {
  const addressToClaim = await contractWrapper.getSignerAddress();
  let maxClaimable = BigNumber.from(0);

  try {
    if (
      !activeClaimCondition.merkleRootHash
        .toString()
        .startsWith(constants.AddressZero)
    ) {
      const claims = await fetchSnapshot(
        activeClaimCondition.merkleRootHash.toString(),
        merkleMetadata,
        storage,
      );
      const item =
        claims &&
        claims.find(
          (c) => c.address.toLowerCase() === addressToClaim.toLowerCase(),
        );
      if (item === undefined) {
        throw new Error("No claim found for this address");
      }
      proofs = item.proof;
      maxClaimable = ethers.utils.parseUnits(item.maxClaimable, tokenDecimals);
    }
  } catch (e) {
    // have to handle the valid error case that we *do* want to throw on
    if ((e as Error)?.message === "No claim found for this address") {
      throw e;
    }
    // other errors we wanna ignore and try to continue
    console.warn(
      "failed to check claim condition merkle root hash, continuing anyways",
      e,
    );
  }

  const overrides = (await contractWrapper.getCallOverrides()) || {};
  const price = activeClaimCondition.price;
  const currencyAddress = activeClaimCondition.currencyAddress;
  if (price.gt(0)) {
    if (isNativeToken(currencyAddress)) {
      overrides["value"] = BigNumber.from(price)
        .mul(quantity)
        .div(ethers.utils.parseUnits("1", tokenDecimals));
    } else {
      const provider = contractWrapper.getProvider() as providers.Provider & {
        isSlide?: boolean;
      };
      const isNotUsingSlide = !provider.isSlide;

      if (isNotUsingSlide) {
        await approveErc20Allowance(
          contractWrapper,
          currencyAddress,
          price,
          quantity,
          tokenDecimals,
        );
      }
    }
  }
  return {
    overrides,
    proofs,
    maxQuantityPerTransaction: maxClaimable,
    price,
    currencyAddress,
  };
}

/**
 * @internal
 * @param merkleRoot
 * @param merkleMetadata
 * @param storage
 */
export async function fetchSnapshot(
  merkleRoot: string,
  merkleMetadata: Record<string, string>,
  storage: IStorage,
) {
  const snapshotUri = merkleMetadata[merkleRoot];
  let snapshot = undefined;
  if (snapshotUri) {
    const raw = await storage.get(snapshotUri);
    const snapshotData = SnapshotSchema.parse(raw);
    if (merkleRoot === snapshotData.merkleRoot) {
      snapshot = snapshotData.claims;
    }
  }
  return snapshot;
}

/**
 * @internal
 * @param index
 * @param claimConditionInput
 * @param existingConditions
 */
export async function updateExistingClaimConditions(
  index: number,
  claimConditionInput: ClaimConditionInput,
  existingConditions: ClaimCondition[],
): Promise<ClaimConditionInput[]> {
  if (index >= existingConditions.length) {
    throw Error(
      `Index out of bounds - got index: ${index} with ${existingConditions.length} conditions`,
    );
  }
  // merge input with existing claim condition
  const priceDecimals = existingConditions[index].currencyMetadata.decimals;
  const priceInWei = existingConditions[index].price;
  const priceInTokens = ethers.utils.formatUnits(priceInWei, priceDecimals);

  // merge existing (output format) with incoming (input format)
  const newConditionParsed = ClaimConditionInputSchema.parse({
    ...existingConditions[index],
    price: priceInTokens,
    ...claimConditionInput,
  });

  // convert to output claim condition
  const mergedConditionOutput = ClaimConditionOutputSchema.parse({
    ...newConditionParsed,
    price: priceInWei,
  });

  return existingConditions.map((existingOutput, i) => {
    let newConditionAtIndex;
    if (i === index) {
      newConditionAtIndex = mergedConditionOutput;
    } else {
      newConditionAtIndex = existingOutput;
    }
    const formattedPrice = ethers.utils.formatUnits(
      newConditionAtIndex.price,
      priceDecimals,
    );
    return {
      ...newConditionAtIndex,
      price: formattedPrice, // manually transform back to input price type
    };
  });
}

/**
 * Fetches the proof for the current signer for a particular wallet.
 *
 * @param merkleRoot - The merkle root of the condition to check.
 * @returns - The proof for the current signer for the specified condition.
 */
export async function getClaimerProofs(
  addressToClaim: string,
  merkleRoot: string,
  tokenDecimals: number,
  merkleMetadata: Record<string, string>,
  storage: IStorage,
): Promise<{ maxClaimable: BigNumber; proof: string[] }> {
  const claims = await fetchSnapshot(merkleRoot, merkleMetadata, storage);
  if (claims === undefined) {
    return {
      proof: [],
      maxClaimable: BigNumber.from(0),
    };
  }
  const item = claims.find(
    (c) => c.address.toLowerCase() === addressToClaim?.toLowerCase(),
  );

  if (item === undefined) {
    return {
      proof: [],
      maxClaimable: BigNumber.from(0),
    };
  }
  return {
    proof: item.proof,
    maxClaimable: ethers.utils.parseUnits(item.maxClaimable, tokenDecimals),
  };
}

/**
 * Create and uploads snapshots + converts claim conditions to contract format
 * @param claimConditionInputs
 * @param tokenDecimals
 * @param provider
 * @param storage
 * @internal
 */
export async function processClaimConditionInputs(
  claimConditionInputs: ClaimConditionInput[],
  tokenDecimals: number,
  provider: providers.Provider,
  storage: IStorage,
) {
  const snapshotInfos: SnapshotInfo[] = [];
  const inputsWithSnapshots = await Promise.all(
    claimConditionInputs.map(async (conditionInput) => {
      // check snapshots and upload if provided
      if (conditionInput.snapshot && conditionInput.snapshot.length > 0) {
        const snapshotInfo = await createSnapshot(
          SnapshotInputSchema.parse(conditionInput.snapshot),
          tokenDecimals,
          storage,
        );
        snapshotInfos.push(snapshotInfo);
        conditionInput.merkleRootHash = snapshotInfo.merkleRoot;
      } else {
        // if no snapshot is passed or empty, reset the merkle root
        conditionInput.merkleRootHash = utils.hexZeroPad([0], 32);
      }
      // fill condition with defaults values if not provided
      return conditionInput;
    }),
  );

  const parsedInputs = ClaimConditionInputArray.parse(inputsWithSnapshots);

  // Convert processed inputs to the format the contract expects, and sort by timestamp
  const sortedConditions: IDropClaimCondition.ClaimConditionStruct[] = (
    await Promise.all(
      parsedInputs.map((c) =>
        convertToContractModel(c, tokenDecimals, provider),
      ),
    )
  ).sort((a, b) => {
    const left = BigNumber.from(a.startTimestamp);
    const right = BigNumber.from(b.startTimestamp);
    if (left.eq(right)) {
      return 0;
    } else if (left.gt(right)) {
      return 1;
    } else {
      return -1;
    }
  });
  return { snapshotInfos, sortedConditions };
}

/**
 * Converts a local SDK model to contract model
 * @param c
 * @param tokenDecimals
 * @param provider
 * @internal
 */
async function convertToContractModel(
  c: FilledConditionInput,
  tokenDecimals: number,
  provider: providers.Provider,
): Promise<IDropClaimCondition.ClaimConditionStruct> {
  const currency =
    c.currencyAddress === constants.AddressZero
      ? NATIVE_TOKEN_ADDRESS
      : c.currencyAddress;
  let maxClaimableSupply;
  let quantityLimitPerTransaction;
  if (c.maxQuantity === "unlimited") {
    maxClaimableSupply = ethers.constants.MaxUint256.toString();
  } else {
    maxClaimableSupply = ethers.utils.parseUnits(c.maxQuantity, tokenDecimals);
  }
  if (c.quantityLimitPerTransaction === "unlimited") {
    quantityLimitPerTransaction = ethers.constants.MaxUint256.toString();
  } else {
    quantityLimitPerTransaction = ethers.utils.parseUnits(
      c.quantityLimitPerTransaction,
      tokenDecimals,
    );
  }
  return {
    startTimestamp: c.startTime,
    maxClaimableSupply,
    supplyClaimed: 0,
    quantityLimitPerTransaction,
    waitTimeInSecondsBetweenClaims: c.waitInSeconds,
    pricePerToken: await normalizePriceValue(provider, c.price, currency),
    currency,
    merkleRoot: c.merkleRootHash,
  };
}

/**
 * Transforms a contract model to local model
 * @param pm
 * @param tokenDecimals
 * @param provider
 * @param merkleMetadata
 * @param storage
 * @internal
 */
export async function transformResultToClaimCondition(
  pm: IDropClaimCondition.ClaimConditionStructOutput,
  tokenDecimals: number,
  provider: providers.Provider,
  merkleMetadata: Record<string, string>,
  storage: IStorage,
): Promise<ClaimCondition> {
  const cv = await fetchCurrencyValue(provider, pm.currency, pm.pricePerToken);
  const claims = await fetchSnapshot(pm.merkleRoot, merkleMetadata, storage);
  const maxClaimableSupply = convertToReadableQuantity(
    pm.maxClaimableSupply,
    tokenDecimals,
  );
  const quantityLimitPerTransaction = convertToReadableQuantity(
    pm.quantityLimitPerTransaction,
    tokenDecimals,
  );
  const availableSupply = convertToReadableQuantity(
    BigNumber.from(pm.maxClaimableSupply).sub(pm.supplyClaimed),
    tokenDecimals,
  );
  const currentMintSupply = convertToReadableQuantity(
    pm.supplyClaimed,
    tokenDecimals,
  );
  return ClaimConditionOutputSchema.parse({
    startTime: pm.startTimestamp,
    maxQuantity: maxClaimableSupply,
    currentMintSupply,
    availableSupply,
    quantityLimitPerTransaction,
    waitInSeconds: pm.waitTimeInSecondsBetweenClaims.toString(),
    price: BigNumber.from(pm.pricePerToken),
    currency: pm.currency,
    currencyAddress: pm.currency,
    currencyMetadata: cv,
    merkleRootHash: pm.merkleRoot,
    snapshot: claims,
  });
}

function convertToReadableQuantity(bn: BigNumber, tokenDecimals: number) {
  if (bn.toString() === ethers.constants.MaxUint256.toString()) {
    return "unlimited";
  } else {
    return ethers.utils.formatUnits(bn, tokenDecimals);
  }
}
