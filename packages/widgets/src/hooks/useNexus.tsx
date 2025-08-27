import { useInternalNexus } from '../providers/InternalNexusProvider';

const useNexus = () => {
  const { setProvider, sdk, isSdkInitialized, provider, initializeSdk, deinitializeSdk } =
    useInternalNexus();
  return {
    setProvider,
    sdk,
    isSdkInitialized,
    provider,
    initializeSdk,
    deinitializeSdk,
  };
};

export default useNexus;
