// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Sample verifier that matches SDK string-based signMessage flow.
contract SampleRequestVerifier {
    string internal constant SIGNATURE_PREFIX = "Sign this intent to proceed \n";

    function verifyRequest(bytes calldata signature, address from, bytes32 hash)
        external
        pure
        returns (bool, bytes32)
    {
        return _verify_request(signature, from, hash);
    }

    function _verify_request(bytes calldata signature, address from, bytes32 hash)
        private
        pure
        returns (bool, bytes32)
    {
        // Must match EXACT client string: "Sign this intent to proceed \n" + "0x...."
        bytes memory msgBytes = abi.encodePacked(
            SIGNATURE_PREFIX,
            _toHexString(hash) // 0x + 64 hex chars
        );

        // EIP-191 hash with dynamic decimal length (e.g. 95)
        bytes32 signedMessageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n",
                _toDecString(msgBytes.length),
                msgBytes
            )
        );

        address signer = _recover(signedMessageHash, signature);
        return (signer == from, signedMessageHash);
    }

    function _toHexString(bytes32 data) private pure returns (string memory) {
        bytes16 symbols = 0x30313233343536373839616263646566; // 0-9a-f
        bytes memory out = new bytes(66);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(data[i]);
            out[2 + i * 2] = bytes1(symbols[b >> 4]);
            out[3 + i * 2] = bytes1(symbols[b & 0x0f]);
        }
        return string(out);
    }

    function _toDecString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);

        return ecrecover(digest, v, r, s);
    }
}
