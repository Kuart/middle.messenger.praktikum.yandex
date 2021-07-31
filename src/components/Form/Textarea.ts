import { IComponentModel } from '../../utils';
import './Input.css';

export function Textarea(): IComponentModel {
  return {
    state: {
      error: '',
    },
    template: /* html */ `
    <div class="input">
      <div class="input__control-wrapper">
        <textarea 
          class="input__control message-form__textarea " 
          p:name="name" 
          p:type="type" 
          p:placeholder="placeholder" 
          p:value="value"
          e:input="props.onChange"/>
        <span class="input__underline"></span>
      </div>
      <div class="input__error">{{state.error}}</div>
    </div>`,
  };
}
