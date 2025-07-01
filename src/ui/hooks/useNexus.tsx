import { useInternalNexus } from '../providers/InternalNexusProvider';

const useNexus = () => {
  const { setProvider, sdk, isSdkInitialized, provider } = useInternalNexus();
  return { setProvider, sdk, isSdkInitialized, provider };
};

export default useNexus;
