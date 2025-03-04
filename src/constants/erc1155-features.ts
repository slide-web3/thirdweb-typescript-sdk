import Erc1155EnumerableAbi from "../../abis/IERC1155Enumerable.json";
import Erc1155Abi from "../../abis/IERC1155.json";
import MulticallAbi from "../../abis/IMulticall.json";
import IMintableERC1155Abi from "../../abis/IMintableERC1155.json";

export const FEATURE_EDITION_BATCH_MINTABLE = {
  name: "ERC1155BatchMintable",
  namespace: "edition.mint.batch",
  docLinks: {
    sdk: "sdk.erc1155batchmintable",
    contracts: "IMulticall",
  },
  abis: [Erc1155Abi, IMintableERC1155Abi, MulticallAbi],
  features: {},
} as const;

export const FEATURE_EDITION_MINTABLE = {
  name: "ERC1155Mintable",
  namespace: "edition.mint",
  docLinks: {
    sdk: "sdk.erc1155mintable",
    contracts: "IMintableERC1155",
  },
  abis: [Erc1155Abi, IMintableERC1155Abi],
  features: {
    [FEATURE_EDITION_BATCH_MINTABLE.name]: FEATURE_EDITION_BATCH_MINTABLE,
  },
} as const;

export const FEATURE_EDITION_ENUMERABLE = {
  name: "ERC1155Enumerable",
  namespace: "edition.query",
  docLinks: {
    sdk: "sdk.erc1155",
    contracts: "IERC1155",
  },
  abis: [Erc1155Abi, Erc1155EnumerableAbi],
  features: {},
} as const;

export const FEATURE_EDITION = {
  name: "ERC1155",
  namespace: "edition",
  docLinks: {
    sdk: "sdk.erc1155enumerable",
    contracts: "IERC1155Enumerable",
  },
  abis: [Erc1155Abi],
  features: {
    [FEATURE_EDITION_ENUMERABLE.name]: FEATURE_EDITION_ENUMERABLE,
    [FEATURE_EDITION_MINTABLE.name]: FEATURE_EDITION_MINTABLE,
  },
} as const;
