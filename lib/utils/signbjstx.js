/* @flow */
'use strict';

import * as bitcoin from 'bitcoinjs-lib';
import * as trezor from '../trezortypes';
import * as hdnodeUtils from './hdnode';

import type Session, {MessageResponse} from '../session';

export type OutputInfo = {
    path: Array<number>;
    value: number;
} | {
    address: string;
    value: number;
};

export type InputInfo = {
    hash: Buffer;
    index: number;
    path?: Array<number>;
};

export type TxInfo = {
    inputs: Array<InputInfo>;
    outputs: Array<OutputInfo>;
};

function input2trezor(input: InputInfo): trezor.TransactionInput {
    const {hash, index, path} = input;
    return {
        prev_index: index,
        prev_hash: reverseBuffer(hash).toString('hex'),
        address_n: path,
    };
}

function output2trezor(output: OutputInfo, network: bitcoin.Network): trezor.TransactionOutput {
    if (output.address == null) {
        if (output.path == null) {
            throw new Error('Both address and path of an output cannot be null.');
        }
        return {
            address_n: output.path,
            amount: output.value,
            script_type: 'PAYTOADDRESS',
        };
    }
    const address = output.address;
    const scriptType = getAddressScriptType(address, network);

    return {
        address: address,
        amount: output.value,
        script_type: scriptType,
    };
}

function signedTx2refTx(signedTx: MessageResponse<trezor.SignedTx>): bitcoin.Transaction {
    const res = bitcoin.Transaction.fromHex(signedTx.message.serialized.serialized_tx);
    return res;
}

function bjsTx2refTx(tx: bitcoin.Transaction): trezor.RefTransaction {
    return {
        lock_time: tx.locktime,
        version: tx.version,
        hash: tx.getId(),
        inputs: tx.ins.map((input: bitcoin.Input) => {
            return {
                prev_index: input.index,
                sequence: input.sequence,
                prev_hash: reverseBuffer(input.hash).toString('hex'),
                script_sig: input.script.toString('hex'),
            };
        }),
        bin_outputs: tx.outs.map((output: bitcoin.Output) => {
            return {
                amount: output.value,
                script_pubkey: output.script.toString('hex'),
            };
        }),
    };
}

function deriveOutputScript(
    pathOrAddress: string | Array<number>,
    nodes: Array<bitcoin.HDNode>,
    network: bitcoin.Network
): Buffer {
    const scriptType = typeof pathOrAddress === 'string'
                        ? getAddressScriptType(pathOrAddress, network)
                        : 'PAYTOADDRESS';

    const pkh: Buffer = typeof pathOrAddress === 'string'
                                ? bitcoin.address.fromBase58Check(pathOrAddress).hash
                                : hdnodeUtils.derivePubKeyHash(
                                      nodes,
                                      pathOrAddress[pathOrAddress.length - 2],
                                      pathOrAddress[pathOrAddress.length - 1]
                                );

    if (scriptType === 'PAYTOADDRESS') {
        return bitcoin.script.pubKeyHashOutput(pkh);
    }
    if (scriptType === 'PAYTOSCRIPTHASH') {
        return bitcoin.script.scriptHashOutput(pkh);
    }
    throw new Error('Unknown script type ' + scriptType);
}

function verifyBjsTx(
    inputs: Array<InputInfo>,
    outputs: Array<OutputInfo>,
    nodes: Array<bitcoin.HDNode>,
    resTx: bitcoin.Transaction,
    network: bitcoin.Network
) {
    if (inputs.length !== resTx.ins.length) {
        throw new Error('Signed transaction has wrong length.');
    }
    if (outputs.length !== resTx.outs.length) {
        throw new Error('Signed transaction has wrong length.');
    }

    outputs.map((output, i) => {
        if (output.value !== resTx.outs[i].value) {
            throw new Error('Signed transaction has wrong output value.');
        }
        if (output.address == null && output.path == null) {
            throw new Error('Both path and address cannot be null.');
        }

        const addressOrPath = output.path || output.address;
        const scriptA = deriveOutputScript(addressOrPath, nodes, network);
        const scriptB = resTx.outs[i].script;
        if (scriptA.compare(scriptB) !== 0) {
            throw new Error('Scripts differ');
        }
    });
}

function getAddressScriptType(address: string, network: bitcoin.Network): string {
    const decoded = bitcoin.address.fromBase58Check(address);
    if (decoded.version === network.pubKeyHash) {
        return 'PAYTOADDRESS';
    }
    if (decoded.version === network.scriptHash) {
        return 'PAYTOSCRIPTHASH';
    }
    throw new Error('Unknown address type.');
}

export function signBjsTx(
    session: Session,
    info: TxInfo,
    refTxs: Array<bitcoin.Transaction>,
    nodes: Array<bitcoin.HDNode>,
    coinName: string
): Promise<bitcoin.Transaction> {
    const network: bitcoin.Network = bitcoin.networks[coinName.toLowerCase()];
    if (network == null) {
        return Promise.reject(new Error('No network ' + coinName));
    }

    const trezorInputs: Array<trezor.TransactionInput> = info.inputs.map(i => input2trezor(i));
    const trezorOutputs: Array<trezor.TransactionOutput> =
        info.outputs.map(o => output2trezor(o, network));
    const trezorRefTxs: Array<trezor.RefTransaction> = refTxs.map(tx => bjsTx2refTx(tx));

    return session.signTx(
        trezorInputs,
        trezorOutputs,
        trezorRefTxs,
        coinName
    ).then(tx => signedTx2refTx(tx))
    .then(res => {
        verifyBjsTx(info.inputs, info.outputs, nodes, res, network);
        return res;
    });
}

function reverseBuffer(buf: Buffer): Buffer {
    const copy = new Buffer(buf.length);
    buf.copy(copy);
    [].reverse.call(copy);
    return copy;
}
