import Ember from 'ember';
import DS from 'ember-data';

const sequential = function(tasks) {
  let   first    = Ember.RSVP.resolve()
  const copies   = []
  for (let i = 0 ; i < tasks.length; ++i) {
    first = first.then(
      () => tasks[i]()
    ).then(
      copy => copies.push(copy)
    )
  }
  return first.then(
    () => copies
  )
}


export default Ember.Mixin.create({
  copyable: true,
  copy: function(options, copied) {
    options = options || {};
    copied = copied || {};

    var _this = this;
    return new Ember.RSVP.Promise(function(resolve) {

      var model = _this.constructor;
      var modelName = model.modelName || model.typeKey;
      var id = modelName + "--" + _this.get('id');
      if (copied.hasOwnProperty(id)) {
        return resolve(copied[id]);
      }

      var copy = _this.get('store').createRecord(modelName);
      copied[id] = copy;
      var queue = [];

      model.eachAttribute((attr, { type, options: attributeOptions }) => {
        switch(Ember.typeOf(options[attr])) {
          case 'undefined':
            const value = _this.get(attr)
            const transform = type && Ember.getOwner(_this).lookup(`transform:${type}`)
            if (transform) {
              copy.set(attr,
                transform.deserialize(
                  transform.serialize(value, attributeOptions),
                  attributeOptions
                )
              )
            } else {
              copy.set(attr, value);
            }
            break;
          case 'null':
            copy.set(attr, null);
            break;
          default:
            copy.set(attr, options[attr]);
        }
      });

      model.eachRelationship(function(relName, meta) {
        var rel = _this.get(relName);
        if (!rel) { return; }

        var overwrite;
        var passedOptions = {};
        switch(Ember.typeOf(options[relName])) {
          case 'null':
          return;
          case 'instance':
            overwrite = options[relName];
            break;
          case 'object':
            passedOptions = options[relName];
            break;
          case 'array':
            overwrite = options[relName];
            break;
          default:
        }

        if (rel.constructor === DS.PromiseObject || rel.constructor.superclass === DS.PromiseObject) {
          queue.push(
            () => rel.then(function(obj) {
              if (obj && obj.get('copyable') && !overwrite) {
                return obj.copy(passedOptions, copied).then(function(objCopy) {
                  copy.set(relName, objCopy);
                });
              } else {
                copy.set(relName, overwrite || obj);
              }
            })
          );
        } else if (rel.constructor === DS.PromiseManyArray) {
          if (overwrite) {
            copy.get(relName).setObjects(overwrite);
          } else {
            queue.push(
              () => rel.then(function(array) {
                const resolvedCopies = array.map(function(obj) {
                    if (obj.get('copyable')) {
                      return () => obj.copy(passedOptions, copied);
                    } else {
                      return () => obj;
                    }
                  });
                
                return sequential(resolvedCopies).then(function(copies){
                  copy.get(relName).setObjects(copies);
                });
              })
            );
          }
        } else {
          if (meta.kind === 'belongsTo') {
            var obj = rel;

            if (obj.get('content')) {
              obj = obj.get('content');
            }

            if (obj && obj.get('copyable') && !overwrite) {
              queue.push( 
                () => obj.copy(passedOptions, copied).then(function(objCopy) {
                  copy.set(relName, objCopy);
                })
              );
            } else {
              copy.set(relName, overwrite || obj);
            }

          } else {
            var objs = rel;

            if (objs.get('content')) {
              objs = objs.get('content').compact();
            }

            if (objs.get('firstObject.copyable') && !overwrite) {

              var copies = objs.map(function(obj) {
                return obj.copy(passedOptions, copied);
              });

              queue.push( 
                () => Ember.RSVP.all(copies).then( function(resolvedCopies) {
                  copy.get(relName).setObjects(resolvedCopies);
                })
              );

            } else {
              copy.get(relName).setObjects(overwrite || objs);
            }
          }

        }
      });

      sequential(queue).then(
        () => resolve(copy)
      )
    });
  }
});
