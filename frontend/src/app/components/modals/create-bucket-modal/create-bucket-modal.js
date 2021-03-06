/* Copyright (C) 2016 NooBaa */

import template from './create-bucket-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { getFieldValue, isFieldTouched, isFormValid } from 'utils/form-utils';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { validatePlacementPolicy, warnPlacementPolicy } from 'utils/bucket-utils';
import { getResourceId } from 'utils/resource-utils';
import { validateName } from 'utils/validation-utils';
import * as routes from 'routes';
import {
    touchForm,
    updateModal,
    closeModal,
    createBucket
} from 'action-creators';

const steps = deepFreeze([
    {
        label: 'choose name',
        size: 'small'
    },
    {
        label: 'set policy',
        size: 'xlarge'
    }
]);

const fieldsByStep = deepFreeze({
    0: ['bucketName'],
    1: ['policyType', 'selectedResources']
});

const invalidHostPoolStates = deepFreeze([
    'INITIALIZING',
    'DELETING'
]);

class CreateBucketModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    steps = steps.map(step => step.label);
    dataReady = ko.observable();
    resourcesHref = '';
    isStepValid = false;
    nameRestrictionList = ko.observable();
    existingNames = [];
    systemResourceCount = 0;
    hostPools = ko.observable();
    cloudResources = ko.observable();
    disabledResources = ko.observable();
    fields = {
        step: 0,
        bucketName: '',
        policyType: 'SPREAD',
        selectedResources: []
    };

    onState(state, params) {
        super.onState(state, params);
    }

    selectState(state) {
        return [
            state.buckets,
            state.hostPools,
            state.cloudResources,
            state.forms[this.formName],
            state.location.params.system
        ];
    }

    mapStateToProps(buckets, hostPools, cloudResources, form, system) {
        if (!buckets || !hostPools || !cloudResources || !form) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const existingNames = Object.keys(buckets);
            const systemResourceCount = Object.keys(hostPools).length + Object.keys(cloudResources).length;
            const bucketName = getFieldValue(form, 'bucketName');
            const resourcesHref = realizeUri(routes.resources, { system });
            const isStepValid = isFormValid(form);
            const nameRestrictionList = validateName(bucketName, existingNames)
                .map(({ valid, message }) => ({
                    label: message,
                    css: isFieldTouched(form, 'bucketName') ? (valid ? 'success' : 'error') : ''
                }));

            const disabledResources = Object.values(hostPools)
                .filter(pool => invalidHostPoolStates.includes(pool.mode))
                .map(pool => getResourceId('HOSTS', pool.name));

            ko.assignToProps(this, {
                existingNames,
                systemResourceCount,
                nameRestrictionList,
                resourcesHref,
                isStepValid,
                hostPools,
                cloudResources,
                disabledResources
            });
        }
    }

    onValidate(values) {
        const { step, bucketName, policyType, selectedResources } = values;
        const errors = {};

        if (step === 0) {
            const hasNameErrors = validateName(bucketName, this.existingNames)
                .some(({ valid }) => !valid);

            if (hasNameErrors) {
                errors.bucketName = '';
            }

        } else if (step === 1) {
            if (this.systemResourceCount > 0) {
                validatePlacementPolicy(values, errors);

                // This rule should be inforced only on bucket creation, this is why it's not
                // part of the generic validatePlacementPolicy check.
                if (policyType === 'SPREAD' && selectedResources.length === 0) {
                    errors.selectedResources = 'Spread policy requires at least 1 participating resources';
                }
            }
        }

        return errors;
    }

    onWarn(values) {
        const warnings = {};
        if (this.systemResourceCount === 0) {
            warnings.selectedResources = `This Bucket will be using the internal server’s disks capacity as a storage
                resource until a healthy resource will be added`;

        } else {
            warnPlacementPolicy(
                values,
                this.hostPools(),
                this.cloudResources(),
                warnings
            );
        }

        return warnings;
    }

    onBeforeStep(step) {
        if (!this.isStepValid) {
            this.dispatch(touchForm(this.formName, fieldsByStep[step]));
            return false;
        }

        return true;
    }

    onAfterStep(step) {
        const { size } = steps[step];
        this.dispatch(updateModal({ size }));
    }

    onCancel() {
        this.dispatch(closeModal());
    }

    onSubmit(values) {
        const { bucketName, policyType, selectedResources } = values;

        this.dispatch(closeModal());
        this.dispatch(createBucket(bucketName, policyType, selectedResources));
    }
}

export default {
    viewModel: CreateBucketModalViewModel,
    template: template
};
