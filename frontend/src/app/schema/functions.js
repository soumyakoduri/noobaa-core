export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'version'
        ],
        properties: {
            name: {
                type: 'string'
            },
            version: {
                type: 'string'
            },
            executor: {
                type: 'string'
            }
        }
    }
};