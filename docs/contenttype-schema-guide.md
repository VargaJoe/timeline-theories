
# SenseNet Content Type Schema - AI Agent System Prompt

This prompt is for AI agents that need to create or update XML content type schemas for the SenseNet ECM platform. It is fully self-contained and does not assume any project context. Follow these rules and patterns to ensure valid, maintainable, and user-friendly schemas.

---

## 🛠️ General Rules

- Always use the XML template below as a base for new content types.
- Every field must have a clear, user-friendly `<DisplayName>` and `<Description>`.
- For `<Choice>` fields, use lowercase `value` attributes and capitalized display text (e.g., `<Option value="option1">Option 1</Option>`).
- Add a `<Configuration>` block for every field, even if empty, to allow future extension.
- Use `<AllowedChildTypes></AllowedChildTypes>` unless the type should allow children.
- Use `<AllowIncrementalNaming>true</AllowIncrementalNaming>` for user-created types.
- Add `<Icon>Content</Icon>` for visual consistency.
- Always use the XML namespace: `xmlns="http://schemas.sensenet.com/SenseNet/ContentRepository/ContentTypeDefinition"`

---

## 🧩 Field Type Patterns

- **ShortText**: For titles, names, or short labels.
- **LongText**: For descriptions, notes, or rich text. Use `<ControlHint>sn:RichText</ControlHint>` for rich text editing.
- **Integer**: For numeric values. Use `<MinValue>` and `<MaxValue>` as needed.
- **Boolean**: For true/false flags. Use `<DefaultValue>0</DefaultValue>` for false by default.
- **Choice**: For enumerations. Use `<Options>` with `<Option value="lowercase">DisplayText</Option>`.
- **DateTime**: For dates/times. Use `<DateTimeMode>DateAndTime</DateTimeMode>` and `<Precision>Second</Precision>`.
- **Reference**: For links to other content. Use `<AllowMultiple>false</AllowMultiple>` unless multi-select is needed.
- **Binary**: For file or image uploads. Use `<IsText>false</IsText>` for binary data.

---

## 📝 Example Content Type Schema

```xml
<ContentType name="MyType" parentType="GenericContent" handler="SenseNet.ContentRepository.GenericContent" xmlns="http://schemas.sensenet.com/SenseNet/ContentRepository/ContentTypeDefinition">
  <DisplayName>MyType</DisplayName>
  <Description>Describe the purpose of this type.</Description>
  <Icon>Content</Icon>
  <AllowIncrementalNaming>true</AllowIncrementalNaming>
  <AllowedChildTypes></AllowedChildTypes>
  <Fields>
    <Field name="ShortTextField" type="ShortText">
      <DisplayName>ShortTextField</DisplayName>
      <Description>Short text field example</Description>
      <Configuration>
        <!-- Example: <MaxLength>100</MaxLength> -->
      </Configuration>
    </Field>
    <Field name="ChoiceField" type="Choice">
      <DisplayName>ChoiceField</DisplayName>
      <Description>Choice field example</Description>
      <Configuration>
        <Options>
          <Option value="option1">Option 1</Option>
          <Option value="option2">Option 2</Option>
        </Options>
      </Configuration>
    </Field>
    <!-- Add other field types as needed -->
  </Fields>
</ContentType>
```

---

## ⚡️ AI Agent Implementation Checklist

- [ ] Use the template and field patterns above for all new or updated content types.
- [ ] Validate XML for SenseNet compatibility.
- [ ] Use explicit, user-friendly labels and descriptions.
- [ ] Use lowercase values for all `<Option>` elements.
- [ ] Add `<Configuration>` for all fields.
- [ ] Document any custom logic or constraints in the `<Description>`.