import { MetadataURIOrObject } from "../core/types";
import { UploadError } from "./error";
import axios from "axios";
import { createReadStream, readdirSync } from "fs";
const got = require("got");
const cliProgress = require("cli-progress");
const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

if (!globalThis.FormData) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  globalThis.FormData = require("form-data");
}

/**
 *
 * @param ipfsUrl - the ipfs:// uri
 * @param gatewayUrl - the gateway url
 * @returns the fully formed IPFS url
 * @internal
 */
export function replaceIpfsWithGateway(ipfsUrl: string, gatewayUrl: string) {
  if (!ipfsUrl || typeof ipfsUrl !== "string") {
    return "";
  }
  if (!gatewayUrl.endsWith("/")) {
    gatewayUrl = `${gatewayUrl}/`;
  }
  return ipfsUrl.replace("ipfs://", gatewayUrl);
}

/**
 * A helper function to upload arbitrary data to IPFS and return the resulting IPFS uri.
 * @param data - stringified JSON || File
 * @param contractAddress - (Optional) the contract address to associate the data with
 * @param signerAddress - (Optional) the wallet address of the actor that is uploading the file
 * @returns The `ipfs://<hash>` uri of the uploaded file
 * @public
 */
export async function uploadToIPFS(
  data: string | File,
  contractAddress?: string,
  signerAddress?: string,
): Promise<string> {
  const headers = {
    "X-App-Name": `CONSOLE-TS-SDK-${contractAddress}`,
    "X-Public-Address": signerAddress || "",
  };
  const formData = new FormData();
  formData.append("file", data);
  const res = await fetch("https://upload.nftlabs.co/upload", {
    method: "POST",
    body: formData as any,
    headers,
  });
  try {
    const body = await res.json();
    return body.IpfsUri;
  } catch (e) {
    throw new UploadError(`Failed to upload to IPFS: ${e}`);
  }
}

/**
 * @internal
 */
export async function uploadMetadata(
  metadata: MetadataURIOrObject,
  contractAddress?: string,
  signerAddress?: string,
): Promise<string> {
  if (typeof metadata === "string") {
    return metadata;
  }
  return await uploadToIPFS(
    JSON.stringify(metadata),
    contractAddress,
    signerAddress,
  );
}

export async function batchUpload(
  directory: string,
  contractAddress?: string,
): Promise<string> {
  const headers = {
    "X-App-Name": `CONSOLE-TS-SDK-${contractAddress}`,
  };
  var key = process.env.PINATA_API_KEY;
  var secret = process.env.PINATA_API_SECRET;
  var jwt = process.env.PINATA_API_JWT;
  if (!key || !secret) {
    // await axios.get("https://nftlabs-ipfs-server-batch.zeet-nftlabs.zeet.app/grant", {headers }).then((res) => {

    await axios.get("http://localhost:3002/grant", { headers }).then((res) => {
      key = res.data.key;
      secret = res.data.secret;
      jwt = res.data.jwt;
    });
  }
  const url = `https://api.pinata.cloud/pinning/pinFileToIPFS`;

  const files = readdirSync(directory);
  let data = new FormData() as {
    append(name: string, value: string | Blob, fileName?: string): void;
    delete(name: string): void;
    get(name: string): FormDataEntryValue | null;
    getAll(name: string): FormDataEntryValue[];
    has(name: string): boolean;
    set(name: string, value: string | Blob, fileName?: string): void;
    forEach(
      callbackfn: (
        value: FormDataEntryValue,
        key: string,
        parent: FormData,
      ) => void,
      thisArg?: any,
    ): void;
    getBoundary(): string;
  };
  files.forEach((file) => {
    console.log(`Adding file: ${file}`);
    data.append(
      `file`,
      createReadStream(`${directory}/${file}`) as unknown as Blob,
      { filepath: `files/${file}` } as unknown as string,
    );
  });
  console.log(`Uploading ${files.length} files to IPFS`);
  var x = 0;
  const metadata = {
    name: `CONSOLE-TS-SDK-${contractAddress}`,
  };
  console.log(`metadata: ${JSON.stringify(metadata)}`);
  //console.log(data)
  data.append("pinataMetadata", JSON.stringify(metadata));
  const res = await got(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${data.getBoundary()}`,
      Authorization: `Bearer ${jwt}`,
    },
    body: data,
  })
    .on("uploadProgress", (progress: any) => {
      if (x === 0) {
        bar1.start(1, 0);
        x = 1;
      }
      bar1.update(progress.percent);
    })
    .then((res: { body: { IpfsHash: any } }) => {
      bar1.stop();
      console.log(res.body);
      return res;
    })
    .catch((err: any) => {
      bar1.stop();
      throw new UploadError(`Failed to upload to IPFS: ${err}`);
    });

  //return (await res.json()).IpfsHash
  return await res.body.IpfsHash;
}

export async function batchUploadMetadata(
  directory: string,
  contractAddress?: string,
): Promise<MetadataURIOrObject[]> {
  const ipfsUri = await batchUpload(directory, contractAddress);
  const files = readdirSync(directory);
  var metadatas = [];
  for (var i = 1; i < files.length + 1; i++) {
    metadatas.push(`ipfs://${ipfsUri}/${i}.json`);
  }
  return metadatas;
}
