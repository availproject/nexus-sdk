import { useInternalNexus } from '../providers/InternalNexusProvider';

const useNexus = () => {
  const { setProvider, sdk, isSdkInitialized, provider, initializeSdk } = useInternalNexus();
  return { setProvider, sdk, isSdkInitialized, provider, initializeSdk };
};

export default useNexus;
