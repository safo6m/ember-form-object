import _ from 'lodash';
import Ember from 'ember';
import { isThenable } from 'ember-form-object/utils/core';

export default Ember.Mixin.create({
  init(container, extraProps) {
    Ember.assert('Form object should be instantiated with a container', !!container && 'registry' in container);
    this.container = container;

    this.validations = _.cloneDeep(this.validations || {});
    this.properties = _.cloneDeep(this.properties || {});

    this.isSubmiting = false;
    this.isDirty = false;
    this.isLoaded = false;

    this.addProperties(this.properties);

    _.forEach(extraProps, (value, key) => this.set(key, value));

    this._super(...arguments);
  },

  onInit: Ember.on('init', function() {
    const propertyNames = _.keys(this.properties);
    this._setCalculatedValuesToVirtualProperties(propertyNames);
    this._updateIsLoaded();
    this._addObservers(propertyNames);
    this._isInitialized = true;
  }),

  destroy() {
    this._super(...arguments);
    this._removeObservers(_.keys(this.properties));
  },

  beforeSubmit(result) {
    return result;
  },

  afterSubmit(result) {
    return result;
  },

  submit() {
    Ember.assert('Has to be implemented', false);
  },

  save() {
    if (!this.get('isDirty')) {
      return Ember.RSVP.reject();
    }

    this.setAllPropertiesDirtyFlag(true);

    return this.validate().then(() => {
      this.set('isSubmiting', true);
      return this.beforeSubmit(...arguments);
    }).then(() => {
      return this.submit(...arguments);
    }).then(() => {
      return this.afterSubmit(...arguments);
    }).catch(e => {
      Ember.Logger.warn(e);
      throw e;
    }).finally(() => {
      this.set('isSubmiting', false);
    });
  },

  setAllPropertiesDirtyFlag(flag) {
    _.forEach(this.properties, (property, propertyName) => this.setPropertyState(propertyName, 'isDirty', !!flag));
  },

  addProperties(properties) {
    _.forOwn(properties, (initialProp, key) => {
      this.properties[key] = this._initProperty(initialProp, key);
    });

    if (this._isInitialized) {
      const propertyNames = _.keys(properties);
      this._setCalculatedValuesToVirtualProperties(propertyNames);
      this._updateIsLoaded();
      this._addObservers(propertyNames);

      const validationKeys = _(properties).map((val, key) => val.validate ? key : null).compact().value();
      this._initDynamicallyAddedValidations(validationKeys);
    }
  },

  removeProperties(propertyNames) {
    this._removeObservers(propertyNames);
    _.forEach(propertyNames, propertyName => this._removeProperty(propertyName));
  },

  setPropertyState(propertyName, stateName, flag) {
    this.set(`properties.${propertyName}.state.${stateName}`, !!flag);
    this.set(stateName, flag ? this[`_${stateName}`]() : false);
  },

  _initDynamicallyAddedValidations(validationKeys) {
    _.forEach(validationKeys, validationKey => {
      if (this.validations[validationKey].constructor === Object) {
        this.buildRuleValidator(validationKey);
      } else {
        this.buildObjectValidator(validationKey);
      }

      const validator = this.validators.findBy('property', validationKey);
      Ember.assert('Something went wrong with dynamically added validations in form object', !!validator);
      this._initDynamicallyAddedValidator(validator);
    });
  },

  _initDynamicallyAddedValidator(validator) {
    validator.addObserver('errors.[]', this, function(sender) {
      const errors = Ember.A();
      this.validators.forEach(function(innerValidator) {
        if (innerValidator.property === sender.property) {
          errors.addObjects(innerValidator.errors);
        }
      }, this);
      this.set('errors.' + sender.property, errors);
    });
  },

  _setCalculatedValuesToVirtualProperties(propertyNames) {
    _.forEach(propertyNames, propertyName => {
      const prop = this.properties[propertyName];
      if (prop && prop.virtual && _.isFunction(prop.set)) {
        this.set(propertyName, prop.set.call(this));
      }
    });
  },

  _removeProperty(propertyName) {
    this.set(propertyName, void 0);
    delete this.properties[propertyName];
    delete this.validations[propertyName];
    delete this[propertyName];
  },

  _initProperty(initialProp, key) {
    const prop = this._getInitialPropertyDefinition(_.isPlainObject(initialProp) ? initialProp : {});
    prop.state = this._getInitialPropertyState(prop);

    if (prop.virtual) {
      prop.set = (_.isFunction(prop.set) && prop.set) || this[`set${key[0].toUpperCase()}${key.slice(1)}`];
      this[key] = prop.initialValue;
    }

    if (prop.async) {
      prop.state.isLoaded = false;
    }

    if (prop.validate) {
      this.validations[key] = prop.validate;
    }

    return prop;
  },

  _getInitialPropertyDefinition(prop) {
    return {
      virtual: 'virtual' in prop ? !!prop.virtual : true,
      async: 'async' in prop ? !!prop.async : false,
      initialValue: 'value' in prop ? _.result(prop, 'value') : null,
      validate: prop.validate || null
    };
  },

  _getInitialPropertyState(prop) {
    return {
      isDirty: false,
      isLoaded: !prop.async
    };
  },

  _addObservers(propertyNames) {
    _.forEach(propertyNames, propertyName => this.addObserver(propertyName, this, this._formPropertyDidChange));
  },

  _removeObservers(propertyNames) {
    _.forEach(propertyNames, propertyName => this.removeObserver(propertyName, this, this._formPropertyDidChange));
  },

  _getInitialPropertyValue(propertyName) {
    const prop = this.properties[propertyName];
    return prop.initialValue;
  },

  _formPropertyDidChange(obj, propertyName) {
    const prop = this.get(`properties.${propertyName}`);
    const value = this.get(propertyName);
    const isPromiseValue = isThenable(value);

    if (isPromiseValue && !value.isFulfilled) {
      this.setPropertyState(propertyName, 'isLoaded', false);
      value.then(resolvedValue => {
        this.set(propertyName, resolvedValue);
      });
    } else if (!prop.state.isLoaded) {
      this.setPropertyState(propertyName, 'isLoaded', true);
    } else {
      this.setPropertyState(propertyName, 'isDirty', this._shouldBecomeDirty(propertyName));
    }
  },

  _shouldBecomeDirty(propertyName) {
    return !_.isEqual(this.get(propertyName), this._getInitialPropertyValue(propertyName));
  },

  _isDirty() {
    return _.map(this.properties, (prop) => prop.state.isDirty).indexOf(true) >= 0;
  },

  _isLoaded() {
    return _.map(this.properties, (prop) => prop.state.isLoaded).indexOf(false) === -1;
  },

  _updateIsDirty() {
    this.set('isDirty', this._isDirty());
  },

  _updateIsLoaded() {
    this.set('isLoaded', this._isLoaded());
  }
});