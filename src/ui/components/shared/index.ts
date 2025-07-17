// Motion.js components (replacing Radix UI)
export { Button } from './button-motion';
export { Input } from './input';
export { Label } from './label-motion';
export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './dialog-motion';
export { Progress } from './progress-motion';
export { default as AnimatedSelect } from './animated-select';

// Existing components
export { BaseModal } from './base-modal';
export { ChainSelect } from './chain-select';
export { TokenSelect } from './token-select';
export { Shimmer } from './shimmer';
export { ThreeStageProgress } from './three-stage-progress';
export { ChainIcon, TokenIcon } from './icons';

// New atomic components for Figma designs
export { AllowanceForm } from './allowance-form';
export { FormField } from './form-field';
export { AmountInput } from './amount-input';
export { InfoMessage } from './info-message';
export { ActionButtons } from './action-buttons';

// Error formatting utilities
export {
  formatErrorForUI,
  isUserRejectionError,
  isChainError,
  extractChainIdFromError,
  addChainToWallet,
} from '../../utils/utils';

// Enhanced components
export { EnhancedInfoMessage } from './enhanced-info-message';

// Animation components
export { SlideTransition } from './slide-transition';
export { DragConstraintsProvider, useDragConstraints } from './drag-constraints';
