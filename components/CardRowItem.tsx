import React from 'react';
import CardItem, { CardItemProps } from './CardItem';

const CardRowItem: React.FC<Omit<CardItemProps, 'layout'>> = props => <CardItem {...props} layout="row" />;

export default CardRowItem;
