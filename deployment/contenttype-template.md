<ContentType name="MyType" parentType="GenericContent" handler="SenseNet.ContentRepository.GenericContent" xmlns="http://schemas.sensenet.com/SenseNet/ContentRepository/ContentTypeDefinition">
  <DisplayName>MyType</DisplayName>
  <Description></Description>
  <Icon>Content</Icon>
  <AllowIncrementalNaming>true</AllowIncrementalNaming>
  <AllowedChildTypes></AllowedChildTypes>
  <Fields>
    <Field name="ShortTextField" type="ShortText">
      <DisplayName>ShortTextField</DisplayName>
      <Description></Description>
      <Configuration>
        <!--<MaxLength>100</MaxLength>-->
        <!--<MinLength>0</MinLength>-->
        <!--<Regex>[a-zA-Z0-9]*$</Regex>-->
        <!--<ReadOnly>false</ReadOnly>-->
        <!--<Compulsory>false</Compulsory>-->
        <!--<DefaultValue></DefaultValue>-->
        <!--<VisibleBrowse>Choose one from: Show, Hide, Advanced</VisibleBrowse>-->
        <!--<VisibleEdit>Choose one from: Show, Hide, Advanced</VisibleEdit>-->
        <!--<VisibleNew>Choose one from: Show, Hide, Advanced</VisibleNew>-->
      </Configuration>
    </Field>
    <Field name="LongTextField" type="LongText">
      <DisplayName>LongTextField</DisplayName>
      <Description></Description>
      <Configuration>
        <!--<MaxLength>100</MaxLength>-->
        <!--<MinLength>0</MinLength>-->
        <!--<TextType>LongText|RichText|AdvancedRichText</TextType>-->
        <!--<ReadOnly>false</ReadOnly>-->
        <!--<Compulsory>false</Compulsory>-->
        <!--<DefaultValue></DefaultValue>-->
        <!--<VisibleBrowse>Choose one from: Show, Hide, Advanced</VisibleBrowse>-->
        <!--<VisibleEdit>Choose one from: Show, Hide, Advanced</VisibleEdit>-->
        <!--<VisibleNew>Choose one from: Show, Hide, Advanced</VisibleNew>-->
      </Configuration>
    </Field>
    <Field name="IntegerField" type="Integer">
      <DisplayName>IntegerField</DisplayName>
      <Description></Description>
      <Configuration>
        <!--<MinValue>0</MinValue>-->
        <!--<MaxValue>100</MaxValue>-->
        <!--<ReadOnly>false</ReadOnly>-->
        <!--<Compulsory>false</Compulsory>-->
        <!--<DefaultValue></DefaultValue>-->
        <!--<VisibleBrowse>Choose one from: Show, Hide, Advanced</VisibleBrowse>-->
        <!--<VisibleEdit>Choose one from: Show, Hide, Advanced</VisibleEdit>-->
        <!--<VisibleNew>Choose one from: Show, Hide, Advanced</VisibleNew>-->
      </Configuration>
    </Field>
    <Field name="BooleanField" type="Boolean">
      <DisplayName>BooleanField</DisplayName>
      <Description></Description>
      <Configuration>
        <!--<ReadOnly>false</ReadOnly>-->
        <!--<Compulsory>false</Compulsory>-->
        <!--<DefaultValue></DefaultValue>-->
        <!--<VisibleBrowse>Choose one from: Show, Hide, Advanced</VisibleBrowse>-->
        <!--<VisibleEdit>Choose one from: Show, Hide, Advanced</VisibleEdit>-->
        <!--<VisibleNew>Choose one from: Show, Hide, Advanced</VisibleNew>-->
      </Configuration>
    </Field>
    <Field name="ChoiceField" type="Choice">
      <DisplayName>ChoiceField</DisplayName>
      <Description></Description>
      <Configuration>
        <!--<AllowMultiple>false</AllowMultiple>-->
        <!--<AllowExtraValue>false</AllowExtraValue>-->
        <!--<Options>
          <Option selected="true">1</Option>
          <Option>2</Option>
        </Options>-->
        <!--<ReadOnly>false</ReadOnly>-->
        <!--<Compulsory>false</Compulsory>-->
        <!--<DefaultValue></DefaultValue>-->
        <!--<VisibleBrowse>Choose one from: Show, Hide, Advanced</VisibleBrowse>-->
        <!--<VisibleEdit>Choose one from: Show, Hide, Advanced</VisibleEdit>-->
        <!--<VisibleNew>Choose one from: Show, Hide, Advanced</VisibleNew>-->
      </Configuration>
    </Field>
    <Field name="DateTimeField" type="DateTime">
      <DisplayName>DateTimeField</DisplayName>
      <Description></Description>
      <Configuration>
        <DateTimeMode>DateAndTime</DateTimeMode>
        <Precision>Second</Precision>
        <!--<ReadOnly>false</ReadOnly>-->
        <!--<Compulsory>false</Compulsory>-->
        <!--<DefaultValue></DefaultValue>-->
        <!--<VisibleBrowse>Choose one from: Show, Hide, Advanced</VisibleBrowse>-->
        <!--<VisibleEdit>Choose one from: Show, Hide, Advanced</VisibleEdit>-->
        <!--<VisibleNew>Choose one from: Show, Hide, Advanced</VisibleNew>-->
      </Configuration>
    </Field>
    <Field name="ReferenceField" type="Reference">
      <DisplayName>ReferenceField</DisplayName>
      <Description></Description>
      <Configuration>
        <!--<AllowMultiple>true</AllowMultiple>-->
        <!--<AllowedTypes>
          <Type>Type1</Type>
          <Type>Type2</Type>
        </AllowedTypes>-->
        <!--<SelectionRoot>
          <Path>/Root/Path1</Path>
          <Path>/Root/Path2</Path>
        </SelectionRoot>-->
        <!--<DefaultValue>/Root/Path1,/Root/Path2</DefaultValue>-->
        <!--<ReadOnly>false</ReadOnly>-->
        <!--<Compulsory>false</Compulsory>-->
        <!--<VisibleBrowse>Choose one from: Show, Hide, Advanced</VisibleBrowse>-->
        <!--<VisibleEdit>Choose one from: Show, Hide, Advanced</VisibleEdit>-->
        <!--<VisibleNew>Choose one from: Show, Hide, Advanced</VisibleNew>-->
      </Configuration>
    </Field>
    <Field name="BinaryField" type="Binary">
      <DisplayName>BinaryField</DisplayName>
      <Description></Description>
      <Configuration>
        <!--<IsText>true</IsText>-->
        <!--<ReadOnly>false</ReadOnly>-->
        <!--<Compulsory>false</Compulsory>-->
        <!--<DefaultValue></DefaultValue>-->
        <!--<VisibleBrowse>Choose one from: Show, Hide, Advanced</VisibleBrowse>-->
        <!--<VisibleEdit>Choose one from: Show, Hide, Advanced</VisibleEdit>-->
        <!--<VisibleNew>Choose one from: Show, Hide, Advanced</VisibleNew>-->
        </Configuration>
    </Field>
  </Fields>
</ContentType>