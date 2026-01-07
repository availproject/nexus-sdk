import fs from 'fs';

export interface ConfigurationFile {
  profiles: Profile[];
  network: any;
  chains: [number, string][];
}

export interface Profile {
  privateKey: string;
  operation: 'bridge' | 'bridgeAndTransfer' | 'bridgeAndExecute' | 'exactInSwap' | 'exactOutSwap';
  id: string;
  network: any;
  count: number | null;
}

export function selectProfile(config: ConfigurationFile): Profile {
  const index = process.env.INDEX;
  if (index == undefined) {
    throw new Error('INDEX env variable must be set. Example: INDEX=4');
  }

  const profile = config.profiles.at(+index);
  if (profile == undefined) {
    throw new Error('Failed to find configuration profile with index: ' + +index);
  }

  return profile;
}

// Throws if the configuration file is not found
// Throws if configuration file is malformed
export function readAndParseConfigurationFile(): ConfigurationFile {
  const path = process.env.CONFIGURATION ?? './configuration.json';

  const file = fs.readFileSync(path, 'utf8');
  const conf = JSON.parse(file) as ConfigurationFile;

  if (conf.profiles == undefined || conf.network == undefined || conf.chains == undefined) {
    throw new Error('Configuration file is malformed');
  }

  for (const profile of conf.profiles) {
    validateProfile(profile);
  }

  return conf;
}

function validateProfile(profile: Profile) {
  if (typeof profile.privateKey != 'string') {
    throw new Error('privateKey must be present and must be a string');
  }

  if (!isValidOperation(profile.operation)) {
    throw new Error(
      "operation must be present, must be either 'bridge', 'bridgeAndTransfer', 'bridgeAndExecute', 'exactInSwap' or 'exactOutSwap'",
    );
  }

  if (typeof profile.id != 'string') {
    throw new Error('id must be present and must be a string');
  }

  const params = profile as any;
  if (profile.operation == 'bridge') {
    if (params.amount !== undefined) {
      params.amount = BigInt(params.amount);
    }
    if (params.gas !== undefined) {
      params.gas = BigInt(params.gas);
    }
  }

  if (profile.operation == 'bridgeAndTransfer') {
    if (params.amount !== undefined) {
      params.amount = BigInt(params.amount);
    }
  }

  if (profile.operation == 'bridgeAndExecute') {
    if (params.amount !== undefined) {
      params.amount = BigInt(params.amount);
    }
  }

  if (profile.operation == 'exactOutSwap') {
    if (params.toAmount !== undefined) {
      params.toAmount = BigInt(params.toAmount);
    }
  }

  if (profile.operation == 'exactInSwap') {
    if (Array.isArray(params.from)) {
      for (const f of params.from) {
        if (f?.amount !== undefined) {
          f.amount = BigInt(f.amount);
        }
      }
    }
  }
}

function isValidOperation(value: any): boolean {
  if (value == undefined || typeof value != 'string') {
    return false;
  }

  if (value.toLowerCase() == 'bridge') {
    return true;
  }

  if (value.toLowerCase() == 'bridgeAndTransfer'.toLowerCase()) {
    return true;
  }

  if (value.toLowerCase() == 'bridgeAndExecute'.toLowerCase()) {
    return true;
  }

  if (value.toLowerCase() == 'exactInSwap'.toLowerCase()) {
    return true;
  }

  if (value.toLowerCase() == 'exactOutSwap'.toLowerCase()) {
    return true;
  }

  return false;
}
