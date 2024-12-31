import { Transform } from 'stream';

export default class StateTransform extends Transform {
    constructor() {
        super({
            readableObjectMode: true,
            writableObjectMode: false
        });
        this._state = undefined;
        this._triggerLength = 0;
        this._bufferChunks = [];
        this._bufferLength = 0;
    }

    /**
     * Process a state chunk, and go to next state
     * @param {any} state Current state
     * @param {Buffer} chunk Data chunk
     * @returns {[any, number]} Next state and its length
     */
    // eslint-disable-next-line no-unused-vars
    _processChunk(state, chunk) {
        throw new Error('Need implement _processChunk(state, chunk)');
    }

    _transform(chunk, encoding, done) {
        this._bufferLength += chunk.length;
        this._bufferChunks.push(chunk);
        while (this._bufferLength >= this._triggerLength) {
            const bufferedChunk =
                this._bufferChunks.length === 1 ? this._bufferChunks[0] : Buffer.concat(this._bufferChunks);
            const triggerChunk = bufferedChunk.slice(0, this._triggerLength);
            this._bufferLength -= this._triggerLength;
            this._bufferChunks = [bufferedChunk.slice(this._triggerLength)];
            const next = this._processChunk(this._state, triggerChunk);
            if (next && Array.isArray(next)) {
                [this._state, this._triggerLength] = next;
            } else {
                done(next);
                return;
            }
        }
        done();
    }
}
